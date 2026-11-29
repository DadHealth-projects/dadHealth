import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getSubscriptionSummary } from '@/lib/native-subscriptions/store'
import { createAdminSupabaseClient } from '@/utils/supabase/admin'
import { createServerSupabaseClient } from '@/utils/supabase/server'
import { youngestChildBand } from '@/lib/familyAges'


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
}

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
}

const supabaseAdmin = createAdminSupabaseClient()

const FREE_SEARCH_LIMIT = 3

type Budget = 'free' | 'under_20' | 'over_20'
type ChildAge = 'toddler' | 'primary' | 'teen'

type Body = {
  latitude?: number
  longitude?: number
  postcode?: string
  budget: Budget
  radius?: number
  childAge: ChildAge
  quickFilters?: string[]
  userId?: string
}

type DadDayResult = {
  name: string
  description: string
  address: string
  distanceMiles: number
  estimatedCost: string
  ageRange: string
  websiteUrl: string
  requiresBooking: boolean
}

function startOfMonth(d = new Date()) {
  const dt = new Date(d)
  return new Date(dt.getFullYear(), dt.getMonth(), 1).toISOString()
}

function oneHourAgo() {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString()
}

async function getRequestUser(req: NextRequest) {
  const bearerToken = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const authSupabase = await createServerSupabaseClient()
  const authResult = bearerToken
    ? await supabaseAdmin.auth.getUser(bearerToken)
    : await authSupabase.auth.getUser()
  return authResult.data.user
}

/**
 * Returns the current user's entitlement from the same trusted source as the
 * search action. Mobile must not fall back to a Free allowance when a direct
 * client-side history read is unavailable during session restoration.
 */
export async function GET(req: NextRequest) {
  const diagnostic = diagnostics(req)
  try {
    const user = await getRequestUser(req)
    if (!user) return diagnostic.fail('session_expired', 401)

    diagnostic.stage('allowance')
    const [subscription, countResult, profile] = await Promise.all([
      getSubscriptionSummary(supabaseAdmin, user.id),
      supabaseAdmin
        .from('dad_day_searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('searched_at', startOfMonth()),
      supabaseAdmin.from('user_profile').select('kids_ages,custody_pattern').eq('user_id', user.id).maybeSingle(),
    ])

    if (countResult.error) {
      return diagnostic.fail('allowance_unavailable', 503)
    }

    const isPro = subscription.isPro
    return diagnostic.reply({
      isPro,
      searchesUsed: isPro ? null : countResult.count ?? 0,
      limit: isPro ? null : FREE_SEARCH_LIMIT,
      // A failed/unknown profile read never invents a child age. Search remains usable
      // through an explicit selection; this is not an entitlement field.
      childAge: profile.error || profile.data?.custody_pattern === 'no_children'
        ? null : youngestChildBand(profile.data?.kids_ages),
    })
  } catch {
    return diagnostic.fail('allowance_unavailable', 503)
  }
}

function coerceNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return fallback
}

const budgetMap: Record<Budget, string> = {
  free: 'completely free with no entry cost',
  under_20: 'under £20 per person total including the dad',
  over_20: 'over £20 per person — premium experiences worth planning for',
}

const ageMap: Record<ChildAge, string> = {
  toddler: 'toddler aged 0 to 4',
  primary: 'primary school age child aged 5 to 11',
  teen: 'teenager aged 12 and over',
}

function buildPrompt(params: {
  latitude?: number
  longitude?: number
  postcode?: string
  budget: Budget
  radius: number
  childAge: ChildAge
  quickFilters: string[]
}) {
  const { latitude, longitude, postcode, budget, radius, childAge, quickFilters } = params
  const quickFilterCopy: Record<string, string> = {
    '60_minutes': 'activities that fit within about 60 minutes',
    under_20: 'activities costing £20 or less',
    raining: 'indoor or weather-proof activities suitable for rainy weather',
    active: 'active and energetic activities',
    creative: 'creative, making, or arts-based activities',
    at_home: 'at-home activities or activities that can be done at home',
  }
  const preferences = quickFilters.map((filter) => quickFilterCopy[filter]).filter(Boolean)

  return `
Find 10 real dad and child activities within ${radius} miles of
${postcode || `coordinates ${latitude}, ${longitude}`}.

Budget: ${budgetMap[budget]}.
Child age: ${ageMap[childAge]}.
${preferences.length ? `Quick preferences: ${preferences.join('; ')}.` : ''}

Include a mix of:
- parks
- soft play
- museums
- farm parks
- activity centres
- sports venues
- nature reserves
- cinemas
- bowling
- local events happening this weekend where possible

For each activity return a JSON object with these exact fields:
{
  "name": string,
  "description": string,
  "address": string,
  "distanceMiles": number,
  "estimatedCost": string,
  "ageRange": string,
  "websiteUrl": string,
  "requiresBooking": boolean
}

Rules:
- description max 20 words
- plain English only
- real places only
- direct website links where possible
- return ONLY valid JSON array
- no markdown
- no explanations
- no code blocks
- never return an object with "error"

Return a JSON array with exactly 10 objects.
`.trim()
}

const getJsonFromText = (text: string) => {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const firstArray = cleaned.indexOf('[')
    const lastArray = cleaned.lastIndexOf(']')

    if (firstArray >= 0 && lastArray > firstArray) {
      return JSON.parse(cleaned.slice(firstArray, lastArray + 1))
    }

    throw new Error('AI returned invalid JSON')
  }
}

// Only fixed codes and stages cross the diagnostics boundary. Never log errors,
// prompts, provider payloads, coordinates, account identifiers or credentials.
function diagnostics(req: NextRequest) {
  const supplied = req.headers.get('x-dad-days-request-id')
  const requestId = supplied && /^[a-f0-9-]{36}$/i.test(supplied) ? supplied : randomUUID()
  const started = Date.now()
  let stage = 'authentication'
  return {
    stage(value: string) { stage = value },
    reply(body: object, status = 200, code = 'ok') {
      if (status >= 400 || process.env.DAD_DAYS_DEBUG === '1') {
        console.info('[DadDays]', { requestId, stage, status, code, durationMs: Date.now() - started })
      }
      return NextResponse.json(body, { status, headers: { 'X-Dad-Days-Request-ID': requestId, 'Cache-Control': 'private, no-store' } })
    },
    fail(code: string, status: number) { return this.reply({ error: code }, status, code) },
  }
}

function validResults(value: unknown): value is DadDayResult[] {
  return Array.isArray(value) && value.every(item => item &&
    ['name', 'description', 'address', 'estimatedCost', 'ageRange', 'websiteUrl'].every(key => typeof item[key] === 'string') &&
    typeof item.distanceMiles === 'number' && Number.isFinite(item.distanceMiles) &&
    typeof item.requiresBooking === 'boolean')
}

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const diagnostic = diagnostics(req)
  let stage = 'validation'
  const at = (value: string) => { stage = value; diagnostic.stage(value) }

  try {
    at('configuration')
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (!anthropicKey || !supabaseUrl || !serviceRoleKey) {
      return diagnostic.fail('provider_configuration', 503)
    }

    at('validation')
    const body = (await req.json()) as Partial<Body>
    if (!body || typeof body !== 'object') return diagnostic.fail('invalid_request', 400)

    const budget = body.budget as Budget | undefined
    const childAge = body.childAge as ChildAge | undefined
    const quickFilters = Array.isArray(body.quickFilters) ? body.quickFilters.filter((filter): filter is string => typeof filter === 'string').slice(0, 6) : []

    if (
      !budget ||
      !childAge ||
      !Object.prototype.hasOwnProperty.call(ageMap, childAge) ||
      !Object.prototype.hasOwnProperty.call(budgetMap, budget)
    ) {
      return diagnostic.fail('invalid_request', 400)
    }

    const hasCoordinates = typeof body.latitude === 'number' && Number.isFinite(body.latitude) && Math.abs(body.latitude) <= 90 &&
      typeof body.longitude === 'number' && Number.isFinite(body.longitude) && Math.abs(body.longitude) <= 180
    const hasPostcode = typeof body.postcode === 'string' && body.postcode.trim().length > 0 && body.postcode.length <= 12
    if ((!hasCoordinates && !hasPostcode) || (body.radius !== undefined && ![5, 10, 20, 50].includes(body.radius))) {
      return diagnostic.fail('invalid_request', 400)
    }
    at('authentication')
    const user = await getRequestUser(req)

    if (!user) {
      return diagnostic.fail('session_expired', 401)
    }

    const userId = user.id

    const radius = coerceNumber(body.radius, 20)

    let searchesUsed: number | null = null

    at('allowance')
    const { count: hourlyCount, error: hourlyError } = await supabaseAdmin
      .from('dad_day_searches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('searched_at', oneHourAgo())

    if (hourlyError || typeof hourlyCount !== 'number') return diagnostic.fail('allowance_unavailable', 503)

    if (typeof hourlyCount === 'number' && hourlyCount >= 10) {
      return diagnostic.fail('rate_limit_exceeded', 429)
    }

    const isPro = (await getSubscriptionSummary(supabaseAdmin, userId)).isPro


    if (isPro) {
      searchesUsed = null
    } else {
      const { count, error: countError } = await supabaseAdmin
        .from('dad_day_searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('searched_at', startOfMonth())

      if (countError || typeof count !== 'number') return diagnostic.fail('allowance_unavailable', 503)
      const used = count
      searchesUsed = used

      if (used >= FREE_SEARCH_LIMIT) {
        return diagnostic.reply(
          {
            error: 'search_limit_reached',
            searchesUsed: used,
            limit: FREE_SEARCH_LIMIT,
          },
          403, 'search_limit_reached'
        )
      }
    }

    const prompt = buildPrompt({
      latitude: body.latitude,
      longitude: body.longitude,
      postcode: body.postcode,
      budget,
      radius,
      childAge,
      quickFilters,
    })

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      timeout: 40000,
      maxRetries: 0,
    })

    at('provider')
    const response = (await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4000,
      temperature: 0.2,
      system: 'You are a UK family activities API. Return ONLY valid JSON.',
      messages: [{ role: 'user', content: prompt }],
    })) as Anthropic.Message

    const textBlock = response.content.find(
      (b: any) => b?.type === 'text'
    ) as any

    const text = textBlock?.text ?? ''

    at('provider_response')
    const results: unknown = getJsonFromText(text)
    if (!validResults(results)) return diagnostic.fail('provider_response_invalid', 502)

    at('save_usage')
    const { error: saveError } = await supabaseAdmin.from('dad_day_searches').insert({
      user_id: userId,
      budget,
      radius,
      child_age: childAge,
      result_count: results.length,
      searched_at: new Date().toISOString(),
    })

    if (saveError) return diagnostic.fail('usage_save_failed', 503)
    return diagnostic.reply({
      results,
      searchesUsed: isPro ? null : searchesUsed + 1,
      limit: isPro ? null : FREE_SEARCH_LIMIT,
    })
  } catch (err) {
    const providerStatus = (err as { status?: number })?.status
    const code = stage === 'validation' ? 'invalid_request'
      : stage === 'authentication' ? 'session_unavailable'
      : stage === 'allowance' ? 'allowance_unavailable'
      : stage === 'provider_response' ? 'provider_response_invalid'
      : stage === 'provider' ? (providerStatus === 429 ? 'provider_busy' : providerStatus === 401 || providerStatus === 403 ? 'provider_configuration' : 'provider_failed')
      : 'server_failed'
    return diagnostic.fail(code, stage === 'validation' ? 400 : stage === 'provider_response' ? 502 : 503)
  }
}

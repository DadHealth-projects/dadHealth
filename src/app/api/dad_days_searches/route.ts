import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { isProSubscriptionStatus } from '@/lib/stripe/subscription'
import { createServerSupabaseClient } from '@/utils/supabase/server'


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
}

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

type Budget = 'free' | 'under_20' | 'over_20'
type ChildAge = 'toddler' | 'primary' | 'teen'

type Body = {
  latitude?: number
  longitude?: number
  postcode?: string
  budget: Budget
  radius?: number
  childAge: ChildAge
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
}) {
  const { latitude, longitude, postcode, budget, radius, childAge } = params

  return `
Find 10 real dad and child activities within ${radius} miles of
${postcode || `coordinates ${latitude}, ${longitude}`}.

Budget: ${budgetMap[budget]}.
Child age: ${ageMap[childAge]}.

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

const getDadDaysErrorDetails = (err: unknown) => {
  const error = err as any

  const providerError = error?.response?.data?.error ?? error?.error

  const message =
    [error?.message, providerError?.message]
      .filter(Boolean)
      .join(' ')
      .trim() || String(err)

  return {
    name: error?.name,
    status:
      error?.status ??
      error?.response?.status ??
      providerError?.status,
    type: error?.type ?? providerError?.type,
    code: error?.code ?? providerError?.code,
    requestId:
      error?.request_id ?? providerError?.request_id,
    message,
  }
}

const getPublicDadDaysError = (err: unknown) => {
  const details = getDadDaysErrorDetails(err)

  const lowerMessage = details.message.toLowerCase()
  const lowerType = String(details.type ?? '').toLowerCase()
  const lowerCode = String(details.code ?? '').toLowerCase()

  if (
    details.status === 401 ||
    details.status === 403 ||
    lowerType.includes('authentication') ||
    lowerMessage.includes('api key') ||
    lowerMessage.includes('permission')
  ) {
    return {
      status: 503,
      message:
        'Dad Days is temporarily unavailable because the AI service is not configured correctly.',
    }
  }

  if (
    details.status === 429 ||
    lowerType.includes('rate') ||
    lowerCode.includes('rate') ||
    lowerMessage.includes('rate limit')
  ) {
    return {
      status: 429,
      message: 'Dad Days is busy right now. Please wait a minute and try again.',
    }
  }

  return {
    status: 500,
    message: 'We could not generate Dad Days right now. Please try again shortly.',
  }
}

export const maxDuration = 60

export async function POST(req: NextRequest) {
  let requestBody: Partial<Body> | null = null

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (!anthropicKey || !supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 503 }
      )
    }

    const body = (await req.json()) as Partial<Body>
    requestBody = body

    const budget = body.budget as Budget | undefined
    const childAge = body.childAge as ChildAge | undefined

    if (!budget || !childAge) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const bearerToken = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    const authSupabase = await createServerSupabaseClient()
    const authResult = bearerToken
      ? await supabaseAdmin.auth.getUser(bearerToken)
      : await authSupabase.auth.getUser()
    const user = authResult.data.user

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.id

    const radius = coerceNumber(body.radius, 20)

    const FREE_SEARCH_LIMIT = 3
    let searchesUsed: number | null = null

    const { count: hourlyCount } = await supabaseAdmin
      .from('dad_day_searches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('searched_at', oneHourAgo())

    if (typeof hourlyCount === 'number' && hourlyCount >= 10) {
      return NextResponse.json({ error: 'rate_limit_exceeded' }, { status: 429 })
    }

    const { data: profile } = await supabaseAdmin
      .from('user_profile')
      .select('is_pro, subscription_status')
      .eq('user_id', userId)
      .maybeSingle()

    const p = profile as {
      is_pro?: boolean | string | number | null
      subscription_status?: string | null
    } | null

    const isPro =
      p?.is_pro === true ||
      p?.is_pro === 'true' ||
      p?.is_pro === 1 ||
      p?.is_pro === '1' ||
      isProSubscriptionStatus(p?.subscription_status)


    if (isPro) {
      searchesUsed = null
    } else {
      const { count } = await supabaseAdmin
        .from('dad_day_searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('searched_at', startOfMonth())

      const used = typeof count === 'number' ? count : 0
      searchesUsed = used

      if (used >= FREE_SEARCH_LIMIT) {
        return NextResponse.json(
          {
            error: 'search_limit_reached',
            searchesUsed: used,
            limit: FREE_SEARCH_LIMIT,
          },
          { status: 403 }
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
    })

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      timeout: 40000,
      maxRetries: 0,
    })

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

    const results = getJsonFromText(text) as DadDayResult[]

    await supabaseAdmin.from('dad_day_searches').insert({
      user_id: userId,
      budget,
      radius,
      child_age: childAge,
      result_count: results.length,
      searched_at: new Date().toISOString(),
    })

    return NextResponse.json({
      results,
      searchesUsed: isPro ? null : searchesUsed + 1,
      limit: isPro ? null : FREE_SEARCH_LIMIT,
    })
  } catch (err) {
    const publicError = getPublicDadDaysError(err)

    return NextResponse.json(
      { error: publicError.message },
      { status: publicError.status }
    )
  }
}

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const role = value => value === 'PUBLIC' ? 'PUBLIC' : '"' + value.replaceAll('"', '""') + '"';
export function buildRollback(snapshot) {
  if (snapshot?.snapshot_version !== 1 || !Array.isArray(snapshot.rollback_functions) || !Array.isArray(snapshot.rollback_acl)) throw Error('Invalid preflight snapshot');
  const functions = ['complete_task','handle_daily_checkin','get_comment_author_names','can_save_recipe'];
  for (const name of functions) {
    if (snapshot.rollback_functions.filter(f => f.identity.startsWith('public.' + name + '(')).length !== 1) throw Error('Missing or ambiguous original function: ' + name);
  }
  const lines = [
    '-- TARGETED SECURITY ROLLBACK. Generated from a trusted pre-change snapshot.',
    '-- Contains old security permissions: review every GRANT before explicit approval.',
    '-- Not a database backup. No table data, RLS policies, jobs or health functions changed.',
    'begin;',
    "do $$begin if current_setting('dadhealth.security_rollback_approved',true) is distinct from 'yes' then raise exception 'Rollback requires explicit approval'; end if; end $$;",
  ];
  for (const f of snapshot.rollback_functions) {
    if (typeof f.definition !== 'string' || !/^CREATE OR REPLACE FUNCTION public\./i.test(f.definition)) throw Error('Invalid function definition');
    lines.push(f.definition.trimEnd() + ';', `alter function ${f.identity} owner to ${role(f.owner)};`);
  }
  const privileges = new Set(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','EXECUTE','USAGE','CREATE','MAINTAIN']);
  for (const o of snapshot.rollback_acl) {
    if (!['TABLE','SEQUENCE','FUNCTION','SCHEMA'].includes(o.kind) || !Array.isArray(o.roles) || !Array.isArray(o.grants)
      || !(o.identity === 'net' || o.identity.startsWith('net.') || o.identity.startsWith('public.'))) throw Error('Invalid ACL snapshot');
    // Snapshot is trusted operator input, never an application request.
    lines.push(`revoke all privileges on ${o.kind} ${o.identity} from ${o.roles.map(role).join(', ')};`);
    for (const g of o.grants) {
      if (!privileges.has(g.privilege) || !o.roles.includes(g.role)) throw Error('Invalid grant');
      if (g.grantor && g.grantor !== o.owner) throw Error('Non-owner grant chain requires manual rollback review');
      lines.push(`grant ${g.privilege} on ${o.kind} ${o.identity} to ${role(g.role)}${g.grantable ? ' with grant option' : ''};`);
    }
  }
  lines.push('commit;', '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node scripts/security-migration-rollback.mjs <trusted-before.json> <new-rollback.sql>');
  const raw = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  const snapshot = Array.isArray(raw) ? raw[0]?.security_preflight : raw.security_preflight ?? raw;
  writeFileSync(output, buildRollback(snapshot), { flag: 'wx' });
  console.log('Rollback SQL written. Review required; nothing executed.');
}

// api/firewall/seed.js
// Llena fw_challenges.flag_hash con HMAC-SHA256 de las flags canónicas.
// Uso: node api/firewall/seed.js
//
// Requiere FW_FLAG_SECRET en .env

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { hashFlag } = require('./flags');

// ─────────────────────────────────────────────────────────────────────
// Flags canónicas (las que el firewall genera y el participante envía)
// Para cambiar una flag: actualizar aquí y volver a correr el script.
// Las que tienen <CHARS> son determinísticas — el participante captura
// los caracteres del log del firewall y los pega tal cual.
// ─────────────────────────────────────────────────────────────────────

const CANONICAL_FLAGS = {
  // L1
  M01: 'flag{HOST_RENAMED_a1b2}',
  M02: 'flag{IFACE_UP_c3d4}',
  // L2
  M03: 'flag{LAN_TRAFFIC_OK}',
  M04: 'flag{NAT_RESTORED_e5f6}',
  // L3
  M05: 'flag{IPS_SIG_8c14}',
  M06: 'flag{WEB_FILTERED_4d72}',
  M07: 'flag{SSL_DEEP_INSPECT}',
  // L4
  M08: 'flag{IPSEC_UP_BO_CL}',
  M09: 'flag{SSLVPN_USER_OK}',
  // L5
  M10: 'flag{PCAP_DROP_3110}',
  M11: 'flag{HA_RESYNCED}',
  // BOSS — calculada server-side por participant_code, no se hashea aquí
  BOSS: null
};

async function main() {
  if (!process.env.FW_FLAG_SECRET) {
    console.error('ERROR: FW_FLAG_SECRET no está configurada. Agrégala en .env');
    console.error('Para generarla: openssl rand -hex 32');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('ERROR: SUPABASE_URL y SUPABASE_ANON_KEY deben estar en .env');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );

  console.log('[FW seed] conectado a', process.env.SUPABASE_URL);
  console.log('[FW seed] cargando challenges...');

  const { data: challenges, error } = await supabase
    .from('fw_challenges')
    .select('id, code, title, flag_hash')
    .order('level').order('order_in_level');
  if (error) {
    console.error('[FW seed] error leyendo challenges:', error.message);
    process.exit(1);
  }
  if (!challenges || challenges.length === 0) {
    console.error('[FW seed] ningún challenge encontrado. ¿Aplicaste 01_schema_supabase.sql?');
    process.exit(1);
  }

  console.log(`[FW seed] ${challenges.length} challenges encontrados.\n`);

  let updated = 0, skipped = 0, errors = 0;

  for (const ch of challenges) {
    if (ch.id === 'BOSS') {
      console.log(`[FW seed] ${ch.id}  · BOSS — flag computada por participante, marcando placeholder fijo`);
      const { error: e } = await supabase
        .from('fw_challenges')
        .update({ flag_hash: 'COMPUTED_PER_PARTICIPANT' })
        .eq('id', ch.id);
      if (e) { errors++; console.error('  ERROR:', e.message); } else { updated++; }
      continue;
    }

    const canonical = CANONICAL_FLAGS[ch.id];
    if (!canonical) {
      console.warn(`[FW seed] ${ch.id}  · SIN FLAG CANÓNICA en seed.js — agregar y re-correr.`);
      skipped++;
      continue;
    }

    const newHash = hashFlag(canonical);
    if (ch.flag_hash === newHash) {
      console.log(`[FW seed] ${ch.id}  · ya está al día (${ch.title})`);
      skipped++;
      continue;
    }

    const { error: e } = await supabase
      .from('fw_challenges')
      .update({ flag_hash: newHash })
      .eq('id', ch.id);
    if (e) {
      console.error(`[FW seed] ${ch.id}  · ERROR:`, e.message);
      errors++;
    } else {
      console.log(`[FW seed] ${ch.id}  · actualizada (${ch.title})`);
      updated++;
    }
  }

  console.log(`\n[FW seed] Resumen: ${updated} actualizadas, ${skipped} sin cambios, ${errors} errores.`);
  if (errors > 0) process.exit(1);
}

main().catch(e => {
  console.error('[FW seed] excepción:', e);
  process.exit(1);
});

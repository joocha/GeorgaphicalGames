// Imports validated content (build.js) into PostgreSQL in ONE transaction.
//
// Idempotent and non-destructive:
// - Rows are upserted by their stable code / natural key; nothing is deleted.
// - A relation or link that disappeared from the content files is not deleted
//   but marked verification_status = 'rejected', so it stops feeding facts
//   and the history stays auditable.
// - A question whose content changed gets version + 1. Rounds already played
//   keep the version and correct answers they were served with
//   (game_answers.question_version / correct_answers).
// - Questions that only exist in the database (e.g. AI drafts from n8n) are
//   left alone. Retire a curated question with "active": false.
import { withTransaction } from '../db.js';

export async function importContent(pool, content, { log = () => {} } = {}) {
  return withTransaction(pool, async (db) => {
    const summary = { sources: 0, countries: 0, objects: 0, relations: 0, links: 0, retiredFacts: 0, stats: 0,
      questions: { inserted: 0, updated: 0, unchanged: 0 } };

    // Sources -------------------------------------------------------------
    const sourceId = new Map();
    for (const s of content.sources) {
      const { rows } = await db.query(
        `INSERT INTO data_sources (code, name, url, license, attribution, notes, retrieved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, license = EXCLUDED.license,
             attribution = EXCLUDED.attribution, notes = EXCLUDED.notes, retrieved_at = EXCLUDED.retrieved_at, updated_at = now()
         RETURNING id`,
        [s.code, s.name, s.url, s.license, s.attribution, s.notes, s.retrievedAt],
      );
      sourceId.set(s.code, rows[0].id);
      summary.sources++;
    }

    // Countries ------------------------------------------------------------
    const countryId = new Map();
    for (const c of content.countries) {
      const { rows } = await db.query(
        `INSERT INTO countries (code, name, is_on_map, wikidata_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET is_on_map = EXCLUDED.is_on_map,
             wikidata_id = COALESCE(EXCLUDED.wikidata_id, countries.wikidata_id), updated_at = now()
         RETURNING id`,
        [c.code, c.name, c.isOnMap, c.wikidataId],
      );
      countryId.set(c.name, rows[0].id);
      summary.countries++;
    }

    // Objects --------------------------------------------------------------
    const objectId = new Map();
    for (const o of content.objects) {
      const { rows } = await db.query(
        `INSERT INTO geo_objects (code, object_type, name, lat, lon, geometry_layer, geometry_key, geometry_feature_id, bbox,
                                  wikidata_id, properties, data_source_id, data_year, verification_status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (code) DO UPDATE SET object_type = EXCLUDED.object_type, name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
             geometry_layer = EXCLUDED.geometry_layer, geometry_key = EXCLUDED.geometry_key, geometry_feature_id = EXCLUDED.geometry_feature_id,
             bbox = EXCLUDED.bbox, wikidata_id = EXCLUDED.wikidata_id, properties = EXCLUDED.properties,
             data_source_id = EXCLUDED.data_source_id, data_year = EXCLUDED.data_year,
             verification_status = EXCLUDED.verification_status, notes = EXCLUDED.notes, updated_at = now()
         RETURNING id`,
        [o.code, o.objectType, o.name, o.lat, o.lon, o.geometry?.layer ?? null, o.geometry?.key ?? null, o.geometry?.featureId ?? null,
          o.geometry ? JSON.stringify(o.geometry.bbox) : null, o.wikidataId, o.properties,
          o.source ? sourceId.get(o.source) : null, o.dataYear, o.verificationStatus, o.notes],
      );
      objectId.set(o.code, rows[0].id);
      summary.objects++;
    }

    // Relations and links: upsert current, retire the ones no longer present.
    const ids = [...objectId.values()];
    const keepRel = [];
    for (const r of content.relations) {
      await db.query(
        `INSERT INTO geo_object_countries (object_id, country_id, relation, data_source_id, note, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (object_id, country_id, relation) DO UPDATE SET data_source_id = EXCLUDED.data_source_id,
             note = EXCLUDED.note, verification_status = EXCLUDED.verification_status`,
        [objectId.get(r.object), countryId.get(r.country), r.relation, sourceId.get(r.source) ?? null, r.note, r.verificationStatus],
      );
      keepRel.push(`${objectId.get(r.object)}|${countryId.get(r.country)}|${r.relation}`);
      summary.relations++;
    }
    const retiredRel = await db.query(
      `UPDATE geo_object_countries SET verification_status = 'rejected',
              note = concat_ws(' ', note, '[removed from content ' || to_char(now(), 'YYYY-MM-DD') || ']')
        WHERE object_id = ANY($1::uuid[]) AND verification_status <> 'rejected'
          AND NOT (object_id::text || '|' || country_id::text || '|' || relation = ANY($2::text[]))`,
      [ids, keepRel],
    );
    const keepLinks = [];
    for (const l of content.links) {
      await db.query(
        `INSERT INTO geo_object_links (object_id, related_object_id, relation, data_source_id, note, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (object_id, related_object_id, relation) DO UPDATE SET data_source_id = EXCLUDED.data_source_id,
             note = EXCLUDED.note, verification_status = EXCLUDED.verification_status`,
        [objectId.get(l.object), objectId.get(l.related), l.relation, sourceId.get(l.source) ?? null, l.note, l.verificationStatus],
      );
      keepLinks.push(`${objectId.get(l.object)}|${objectId.get(l.related)}|${l.relation}`);
      summary.links++;
    }
    const retiredLinks = await db.query(
      `UPDATE geo_object_links SET verification_status = 'rejected',
              note = concat_ws(' ', note, '[removed from content ' || to_char(now(), 'YYYY-MM-DD') || ']')
        WHERE object_id = ANY($1::uuid[]) AND verification_status <> 'rejected'
          AND NOT (object_id::text || '|' || related_object_id::text || '|' || relation = ANY($2::text[]))`,
      [ids, keepLinks],
    );
    summary.retiredFacts = retiredRel.rowCount + retiredLinks.rowCount;

    // Statistics -----------------------------------------------------------
    for (const s of content.stats) {
      await db.query(
        `INSERT INTO country_resource_stats (country_id, resource_object_id, metric, value, unit, data_year, is_estimate, rank,
                                             data_source_id, verification_status, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (country_id, resource_object_id, metric, data_year, data_source_id) DO UPDATE SET
             value = EXCLUDED.value, unit = EXCLUDED.unit, is_estimate = EXCLUDED.is_estimate, rank = EXCLUDED.rank,
             verification_status = EXCLUDED.verification_status, note = EXCLUDED.note, updated_at = now()`,
        [countryId.get(s.country), objectId.get(s.resource), s.metric, s.value, s.unit, s.dataYear, s.isEstimate, s.rank,
          sourceId.get(s.source), s.verificationStatus, s.note],
      );
      summary.stats++;
    }

    // Questions ------------------------------------------------------------
    const { rows: levels } = await db.query(`SELECT id, code, categories FROM game_levels`);
    const levelByCode = new Map(levels.map((l) => [l.code, l]));
    for (const q of content.questions) {
      const level = levelByCode.get(q.levelCode);
      if (!level) throw new Error(`${q.code}: unknown level "${q.levelCode}"`);
      const categories = new Set(level.categories.map((c) => c.code));
      if (!categories.has(q.category)) throw new Error(`${q.code}: category "${q.category}" is not a category of level ${q.levelCode}`);
      if (q.subcategory && !categories.has(q.subcategory)) log(`note: ${q.code} subcategory "${q.subcategory}" is not a level category`);

      const params = [q.code, level.id, q.category, q.subcategory, q.questionType, q.answerMode, q.difficulty, q.questionText,
        q.questionDescription, q.mapObjectType, q.mapObjectCode ? objectId.get(q.mapObjectCode) : null,
        q.map ? JSON.stringify(q.map) : null, JSON.stringify(q.options), JSON.stringify(q.correctAnswers),
        q.factRef ? JSON.stringify(q.factRef) : null, q.explanation, q.basePoints, q.timeLimitSec,
        sourceId.get(q.sourceCode) ?? null, q.dataYear, q.language, q.isActive, q.verificationStatus, q.origin,
        q.reviewedBy, q.reviewNote, q.contentHash];

      const existing = await db.query(`SELECT id, content_hash FROM question_bank WHERE code = $1 FOR UPDATE`, [q.code]);
      if (!existing.rows.length) {
        await db.query(
          `INSERT INTO question_bank (code, level_id, category, subcategory, question_type, answer_mode, difficulty, question_text,
               question_description, map_object_type, map_object_id, map, options, correct_answers, fact_ref, explanation,
               base_points, time_limit_sec, data_source_id, data_year, language, is_active, verification_status, origin,
               reviewed_by, review_note, content_hash, reviewed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
                   $25, $26, $27, CASE WHEN $23::varchar = 'verified' THEN now() END)`,
          params,
        );
        summary.questions.inserted++;
      } else if (existing.rows[0].content_hash !== q.contentHash) {
        await db.query(
          `UPDATE question_bank SET level_id = $2, category = $3, subcategory = $4, question_type = $5, answer_mode = $6,
               difficulty = $7, question_text = $8, question_description = $9, map_object_type = $10, map_object_id = $11,
               map = $12, options = $13, correct_answers = $14, fact_ref = $15, explanation = $16, base_points = $17,
               time_limit_sec = $18, data_source_id = $19, data_year = $20, language = $21, is_active = $22,
               verification_status = $23, origin = $24, reviewed_by = $25, review_note = $26, content_hash = $27,
               reviewed_at = CASE WHEN $23::varchar = 'verified' THEN now() ELSE reviewed_at END,
               version = version + 1, updated_at = now()
           WHERE code = $1`,
          params,
        );
        summary.questions.updated++;
      } else {
        summary.questions.unchanged++;
      }
    }

    return summary;
  });
}

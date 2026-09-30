// lib/validateSchema.js (CommonJS)
//
// JSON Schema validation for PlanSpec using Ajv.
// NOTE: This version avoids draft 2020-12 meta-schema loading issues on Vercel.
// It works with Ajv's default meta-schemas (draft-07).
//
// If your planSchema.json declares "$schema": "https://json-schema.org/draft/2020-12/schema"
// either remove that line OR leave it—Ajv will still complain unless we strip it here.
// So we strip $schema before compiling.

const Ajv = require("ajv");
const rawSchema = require("./planSchema.json");

// Clone schema and strip $schema to avoid Ajv trying to resolve 2020-12 meta-schema
const schema = JSON.parse(JSON.stringify(rawSchema));
if (schema && typeof schema === "object" && "$schema" in schema) {
  delete schema.$schema;
}

const ajv = new Ajv({
  strict: false,
  strictNumbers: true,
  allErrors: true,
  allowUnionTypes: true
});
ajv.addSchema(require('./stairs/stairAssemblySchema.json'));
ajv.addSchema(require('./geometry/bedroomMeasurementBookSchema.json'));

const validate = ajv.compile(schema);

function formatAjvErrors(ajvErrors) {
  if (!Array.isArray(ajvErrors) || ajvErrors.length === 0) return [];
  return ajvErrors.map((e) => {
    const path = e.instancePath || "(root)";
    const msg = e.message || "schema validation error";
    const extra = e.params ? ` (${JSON.stringify(e.params)})` : "";
    return `${path}: ${msg}${extra}`;
  });
}

function validatePlanSpecSchema(planSpec) {
  const ok = validate(planSpec);
  return { valid: !!ok, errors: ok ? [] : formatAjvErrors(validate.errors) };
}

module.exports = { validatePlanSpecSchema };

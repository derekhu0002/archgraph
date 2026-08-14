const fs = require('fs');
const path = require('path');

const repoRoot = process.env.ARGO_REPO_ROOT
    || process.env.WORKSPACE_FOLDER
    || path.resolve(__dirname, '..', '..');
const graphRelativePath = path.join('design', 'KG', 'SystemArchitecture.json');
const graphPath = path.join(repoRoot, graphRelativePath);
const schemaPathCandidates = [
    path.join(repoRoot, '.argo', 'schema', 'SystemArchitecture.schema.json'),
];

const {
  validateGraphSemantics,
  validateArchiMateEndpointMatrix,
  validateViewElementLimits,
} = require('./graph-semantics.js');

function main() {
    const schemaPath = schemaPathCandidates.find(candidate => fs.existsSync(candidate));
    if (!schemaPath) {
        fail(`Schema file is missing. Checked: ${schemaPathCandidates.map(candidate => path.relative(repoRoot, candidate)).join(', ')}`);
    }

    if (!fs.existsSync(graphPath)) {
        fail('System architecture file is missing at design/KG/SystemArchitecture.json');
    }

    const schema = parseJson(schemaPath, path.relative(repoRoot, schemaPath));
    const document = parseJson(graphPath, 'design/KG/SystemArchitecture.json');
    const errors = [];

    validateAgainstSchema(document, schema, '#', errors, schema);
    validateGraphSemantics(document, errors);
    validateArchiMateEndpointMatrix(document, errors);
    validateViewElementLimits(document, errors);

    if (errors.length > 0) {
        console.error('SystemArchitecture validation failed:');
        for (const error of errors) {
            console.error(`- ${error}`);
        }
        process.exit(1);
    }

    console.log('SystemArchitecture validation passed for: design/KG/SystemArchitecture.json');
}

function parseJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        fail(`Failed to parse ${label}: ${String(error)}`);
    }
}

function validateAgainstSchema(value, schemaNode, pointer, errors, rootSchema) {
    if (!schemaNode || typeof schemaNode !== 'object') {
        return;
    }

    const resolvedSchema = schemaNode.$ref ? resolveRef(schemaNode.$ref, rootSchema, errors, pointer) : schemaNode;
    if (!resolvedSchema) {
        return;
    }

    if (resolvedSchema.const !== undefined && !isDeepStrictEqual(value, resolvedSchema.const)) {
        errors.push(`${pointer} must equal ${JSON.stringify(resolvedSchema.const)}`);
        return;
    }

    if (resolvedSchema.enum && !resolvedSchema.enum.some(option => isDeepStrictEqual(option, value))) {
        errors.push(`${pointer} must be one of: ${resolvedSchema.enum.map(option => JSON.stringify(option)).join(', ')}`);
        return;
    }

    if (resolvedSchema.type !== undefined) {
        validateType(value, resolvedSchema.type, pointer, errors);
        if (!typeMatches(value, resolvedSchema.type)) {
            return;
        }
    }

    if (typeof resolvedSchema.minLength === 'number') {
        if (typeof value !== 'string' || value.length < resolvedSchema.minLength) {
            errors.push(`${pointer} must be at least ${resolvedSchema.minLength} character(s) long`);
        }
    }

    if (typeof resolvedSchema.maxLength === 'number') {
        if (typeof value !== 'string' || value.length > resolvedSchema.maxLength) {
            errors.push(`${pointer} must be at most ${resolvedSchema.maxLength} character(s) long`);
        }
    }

    if (resolvedSchema.pattern) {
        const matcher = new RegExp(resolvedSchema.pattern);
        if (typeof value !== 'string' || !matcher.test(value)) {
            errors.push(`${pointer} must match pattern ${JSON.stringify(resolvedSchema.pattern)}`);
        }
    }

    if (typeof resolvedSchema.minimum === 'number') {
        if (typeof value !== 'number' || value < resolvedSchema.minimum) {
            errors.push(`${pointer} must be >= ${resolvedSchema.minimum}`);
        }
    }

    if (typeof resolvedSchema.maximum === 'number') {
        if (typeof value !== 'number' || value > resolvedSchema.maximum) {
            errors.push(`${pointer} must be <= ${resolvedSchema.maximum}`);
        }
    }

    if (typeof resolvedSchema.minItems === 'number') {
        if (!Array.isArray(value) || value.length < resolvedSchema.minItems) {
            errors.push(`${pointer} must contain at least ${resolvedSchema.minItems} item(s)`);
        }
    }

    if (typeof resolvedSchema.maxItems === 'number') {
        if (!Array.isArray(value) || value.length > resolvedSchema.maxItems) {
            errors.push(`${pointer} must contain at most ${resolvedSchema.maxItems} item(s)`);
        }
    }

    if (resolvedSchema.uniqueItems === true && Array.isArray(value)) {
        const seen = new Set();
        value.forEach((entry, index) => {
            const serialized = JSON.stringify(entry);
            if (seen.has(serialized)) {
                errors.push(`${pointer}[${index}] must be unique within ${pointer}`);
            } else {
                seen.add(serialized);
            }
        });
    }

    if (resolvedSchema.type === 'object') {
        validateObject(value, resolvedSchema, pointer, errors, rootSchema);
        return;
    }

    if (resolvedSchema.type === 'array') {
        validateArray(value, resolvedSchema, pointer, errors, rootSchema);
    }
}

function validateObject(value, schemaNode, pointer, errors, rootSchema) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
    }

    const properties = schemaNode.properties || {};
    const required = Array.isArray(schemaNode.required) ? schemaNode.required : [];

    for (const key of required) {
        if (!(key in value)) {
            errors.push(`${pointer} is missing required property '${key}'`);
        }
    }

    if (schemaNode.additionalProperties === false) {
        for (const key of Object.keys(value)) {
            if (!(key in properties)) {
                errors.push(`${pointer} contains unsupported property '${key}'`);
            }
        }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value) {
            validateAgainstSchema(value[key], propertySchema, `${pointer}.${key}`, errors, rootSchema);
        }
    }
}

function validateArray(value, schemaNode, pointer, errors, rootSchema) {
    if (!Array.isArray(value)) {
        return;
    }

    if (schemaNode.items) {
        value.forEach((entry, index) => {
            validateAgainstSchema(entry, schemaNode.items, `${pointer}[${index}]`, errors, rootSchema);
        });
    }
}

function validateType(value, expectedType, pointer, errors) {
    if (!typeMatches(value, expectedType)) {
        const printableType = Array.isArray(expectedType) ? expectedType.join(' or ') : expectedType;
        errors.push(`${pointer} must be of type ${printableType}`);
    }
}

function typeMatches(value, expectedType) {
    if (Array.isArray(expectedType)) {
        return expectedType.some(candidate => typeMatches(value, candidate));
    }

    switch (expectedType) {
        case 'object':
            return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'array':
            return Array.isArray(value);
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return true;
    }
}

function resolveRef(ref, rootSchema, errors, pointer) {
    if (!ref.startsWith('#/')) {
        errors.push(`${pointer} uses unsupported $ref '${ref}'`);
        return undefined;
    }

    const segments = ref.slice(2).split('/');
    let current = rootSchema;
    for (const segment of segments) {
        if (!current || typeof current !== 'object' || !(segment in current)) {
            errors.push(`${pointer} references missing schema path '${ref}'`);
            return undefined;
        }
        current = current[segment];
    }

    return current;
}

function isDeepStrictEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function fail(message) {
    console.error(`SystemArchitecture validation failed: ${message}`);
    process.exit(1);
}

main();
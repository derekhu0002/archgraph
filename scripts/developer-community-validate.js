'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_ARRAY_FIELDS = ['elements', 'relationships', 'views'];
const ELEMENT_STRING_FIELDS = ['id', 'name', 'type'];
const RELATIONSHIP_STRING_FIELDS = ['source_id', 'target_id', 'type'];
const VIEW_STRING_FIELDS = ['view_id', 'view_name'];
const DEFAULT_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function validateSubgraph(obj, sizeLimitBytes) {
    const errors = [];

    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        errors.push('subgraph must be a JSON object');
        return { valid: false, errors };
    }

    for (const field of REQUIRED_ARRAY_FIELDS) {
        if (!Array.isArray(obj[field])) {
            errors.push(`missing required array field '${field}'`);
        }
    }

    if (Array.isArray(obj.elements)) {
        obj.elements.forEach((element, index) => {
            if (element === null || typeof element !== 'object' || Array.isArray(element)) {
                errors.push(`elements[${index}] must be an object`);
                return;
            }
            for (const field of ELEMENT_STRING_FIELDS) {
                if (!isNonEmptyString(element[field])) {
                    errors.push(`elements[${index}] missing string field '${field}'`);
                }
            }
        });
    }

    if (Array.isArray(obj.relationships)) {
        obj.relationships.forEach((relationship, index) => {
            if (relationship === null || typeof relationship !== 'object' || Array.isArray(relationship)) {
                errors.push(`relationships[${index}] must be an object`);
                return;
            }
            for (const field of RELATIONSHIP_STRING_FIELDS) {
                if (!isNonEmptyString(relationship[field])) {
                    errors.push(`relationships[${index}] missing string field '${field}'`);
                }
            }
        });
    }

    if (Array.isArray(obj.views)) {
        obj.views.forEach((view, index) => {
            if (view === null || typeof view !== 'object' || Array.isArray(view)) {
                errors.push(`views[${index}] must be an object`);
                return;
            }
            for (const field of VIEW_STRING_FIELDS) {
                if (!isNonEmptyString(view[field])) {
                    errors.push(`views[${index}] missing string field '${field}'`);
                }
            }
        });
    }

    let size;
    try {
        size = Buffer.byteLength(JSON.stringify(obj), 'utf8');
    } catch (error) {
        errors.push(`subgraph JSON could not be serialized: ${error.message}`);
        return { valid: false, errors };
    }

    const limit = typeof sizeLimitBytes === 'number' && Number.isFinite(sizeLimitBytes) && sizeLimitBytes > 0
        ? sizeLimitBytes
        : DEFAULT_SIZE_LIMIT_BYTES;

    if (size > limit) {
        errors.push(`subgraph JSON size ${size} bytes exceeds limit ${limit} bytes`);
    }

    return { valid: errors.length === 0, errors };
}

function main() {
    const filePath = process.argv[2];
    const sizeLimit = Number(process.argv[3]);

    if (!filePath) {
        console.error('Usage: node scripts/developer-community-validate.js <subgraph.json> [sizeLimitBytes]');
        process.exit(2);
    }

    const absolutePath = path.resolve(filePath);
    const limit = Number.isFinite(sizeLimit) && sizeLimit > 0 ? sizeLimit : DEFAULT_SIZE_LIMIT_BYTES;

    let stat;
    try {
        stat = fs.statSync(absolutePath);
    } catch (error) {
        console.error(`Failed to read subgraph JSON: ${filePath}. ${error.message}`);
        process.exit(2);
    }

    if (stat.size > limit) {
        console.error('Subgraph validation failed:');
        console.error(`- subgraph JSON size ${stat.size} bytes exceeds limit ${limit} bytes`);
        process.exit(1);
    }

    let obj;
    try {
        obj = JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        console.error(`Failed to read subgraph JSON: ${filePath}. ${error.message}`);
        process.exit(2);
    }

    const result = validateSubgraph(obj, limit);
    if (result.valid) {
        console.log(`Subgraph validation passed for: ${filePath}`);
        process.exit(0);
    }

    console.error('Subgraph validation failed:');
    for (const error of result.errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

if (require.main === module) {
    main();
}

module.exports = {
    validateSubgraph,
};

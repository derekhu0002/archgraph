'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_ARRAY_FIELDS = ['elements', 'relationships', 'views'];
const DEFAULT_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

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

    const size = Buffer.byteLength(JSON.stringify(obj), 'utf8');
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

    let obj;
    try {
        obj = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        console.error(`Failed to read subgraph JSON: ${filePath}. ${error.message}`);
        process.exit(2);
    }

    const result = validateSubgraph(obj, Number.isFinite(sizeLimit) && sizeLimit > 0 ? sizeLimit : undefined);
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

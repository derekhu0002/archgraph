'use strict';

const fs = require('fs');
const path = require('path');

const CREDENTIAL_KEY_PATTERN = /token|password|passwd|secret|api[-_]?key|apikey|credential|pwd/i;
const CREDENTIAL_VALUE_PATTERN = /\b(sk|pk|AKIA|ASIA|ghp|gho|ghu|ghs|ghr|xox[baprs]|eyJ)[-_A-Za-z0-9]{8,}/;
const COMMIT_KEY_PATTERN = /commit/i;
const WINDOWS_DRIVE_PATH_PATTERN = /[A-Za-z]:[\\/]/;
const UNC_PATH_PATTERN = /\\\\[A-Za-z0-9._-]+\\/;
const UNIX_ABSOLUTE_PATH_PATTERN = /(^|[^A-Za-z0-9_])\/(?:home|usr|opt|etc|var|root|tmp|srv|mnt|media|proc|sys)\//;
const GIT_HASH_PATTERN = /\b[0-9a-f]{40}\b/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /\b\d{11}\b/;

function scanSensitiveInfo(obj) {
    const hits = [];
    walk(obj, '', hits);
    return hits;
}

function walk(node, pathPrefix, hits) {
    if (node === null || typeof node !== 'object') {
        return;
    }

    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            walk(node[i], `${pathPrefix}[${i}]`, hits);
        }
        return;
    }

    for (const key of Object.keys(node)) {
        const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        const value = node[key];
        checkField(key, value, childPath, hits);
        walk(value, childPath, hits);
    }
}

function checkField(key, value, fieldPath, hits) {
    if (value === null || value === undefined || typeof value !== 'string') {
        return;
    }

    const lowerKey = String(key).toLowerCase();
    const text = value;
    const isNameSlot = lowerKey === 'name';

    if (CREDENTIAL_KEY_PATTERN.test(lowerKey) || (isNameSlot && CREDENTIAL_KEY_PATTERN.test(text))) {
        hits.push({ type: 'credential', path: fieldPath, value: text });
    }

    if (COMMIT_KEY_PATTERN.test(lowerKey) || (isNameSlot && COMMIT_KEY_PATTERN.test(text))) {
        hits.push({ type: 'commit', path: fieldPath, value: text });
    }

    if (CREDENTIAL_VALUE_PATTERN.test(text)) {
        hits.push({ type: 'credential', path: fieldPath, value: text });
    }

    if (WINDOWS_DRIVE_PATH_PATTERN.test(text) || UNC_PATH_PATTERN.test(text) || UNIX_ABSOLUTE_PATH_PATTERN.test(text)) {
        hits.push({ type: 'absolute-path', path: fieldPath, value: text });
    }

    if (GIT_HASH_PATTERN.test(text)) {
        hits.push({ type: 'commit', path: fieldPath, value: text });
    }

    if (EMAIL_PATTERN.test(text)) {
        hits.push({ type: 'personal-info', path: fieldPath, value: text });
    }

    if (PHONE_PATTERN.test(text)) {
        hits.push({ type: 'personal-info', path: fieldPath, value: text });
    }
}

function generatePostTemplate({ name, description, author, link }) {
    return [
        `[工作包] ${name || ''}`,
        '',
        `描述：${description || ''}`,
        '',
        `作者：${author || ''}`,
        '',
        `子图链接：${link || ''}`,
    ].join('\n');
}

function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node scripts/developer-community-publish.js <subgraph.json>');
        process.exit(2);
    }

    const absolutePath = path.resolve(filePath);
    let obj;
    try {
        obj = JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        console.error(`Failed to read subgraph JSON: ${filePath}. ${error.message}`);
        process.exit(2);
    }

    const hits = scanSensitiveInfo(obj);

    console.log(generatePostTemplate({
        name: obj && obj.name ? obj.name : '',
        description: obj && obj.description ? obj.description : '',
        author: process.env.GITHUB_ACTOR || process.env.USER || process.env.USERNAME || '你的 GitHub 账号',
        link: process.env.SUBGRAPH_LINK || '',
    }));

    if (hits.length > 0) {
        console.error('命中即告警，需清理后再发布');
        for (const hit of hits) {
            console.error(`- [${hit.type}] ${hit.path}: ${hit.value}`);
        }
        process.exit(1);
    }

    console.log('敏感信息扫描通过：未命中敏感模式。');
}

if (require.main === module) {
    main();
}

module.exports = {
    scanSensitiveInfo,
    generatePostTemplate,
};

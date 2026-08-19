'use strict';

const fs = require('fs');
const path = require('path');

const CREDENTIAL_KEY_PATTERN = /token|password|passwd|secret|api[-_]?key|apikey|credential|pwd|private[-_]?key|access[-_]?key|\bconnection|\bauth\b|\bbearer\b|\bjwt\b/i;
const CREDENTIAL_VALUE_PATTERN = /\b(sk|pk|AKIA|ASIA|ghp|gho|ghu|ghs|ghr|xox[baprs]|eyJ)[-_A-Za-z0-9]{8,}/;
const COMMIT_KEY_PATTERN = /commit/i;
const WINDOWS_DRIVE_PATH_PATTERN = /[A-Za-z]:[\\/]/;
const UNC_PATH_PATTERN = /\\\\[A-Za-z0-9._-]+\\/;
const UNIX_ABSOLUTE_PATH_PATTERN = /(^|[^A-Za-z0-9_])\/(?:home|usr|opt|etc|var|root|tmp|srv|mnt|media|proc|sys|data|apps|projects)\//;
const ENV_VAR_PATH_PATTERN = /\$[A-Z_][A-Z0-9_]*|%[A-Z_][A-Z0-9_]*%/;
const TILDE_PATH_PATTERN = /~[/\\]/;
const GIT_BASH_PATH_PATTERN = /(^|[^A-Za-z0-9_])\/c\//;
const GIT_HASH_PATTERN = /\b[0-9a-f]{40}\b/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /\b\d{11}\b/;

const MAX_WALK_DEPTH = 10000;
const SCAN_DISCLAIMER = '提示：本扫描为辅助性质，『内部备注』等无法启发式识别的项仍需人工核对。';

function scanSensitiveInfo(obj) {
    const hits = [];
    try {
        walk(obj, hits);
    } catch (error) {
        hits.push({ type: 'scan-error', path: '', value: error.message });
    }
    return hits;
}

function walk(root, hits) {
    const stack = [{ node: root, pathPrefix: '', depth: 0 }];
    while (stack.length > 0) {
        const { node, pathPrefix, depth } = stack.pop();

        if (node === null || typeof node !== 'object') {
            continue;
        }

        if (depth > MAX_WALK_DEPTH) {
            continue;
        }

        if (Array.isArray(node)) {
            for (let i = node.length - 1; i >= 0; i--) {
                stack.push({ node: node[i], pathPrefix: `${pathPrefix}[${i}]`, depth: depth + 1 });
            }
            continue;
        }

        const keys = Object.keys(node);
        for (let i = keys.length - 1; i >= 0; i--) {
            const key = keys[i];
            const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
            const value = node[key];
            checkField(key, value, childPath, hits);
            stack.push({ node: value, pathPrefix: childPath, depth: depth + 1 });
        }
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

    if (WINDOWS_DRIVE_PATH_PATTERN.test(text) || UNC_PATH_PATTERN.test(text) || UNIX_ABSOLUTE_PATH_PATTERN.test(text) || ENV_VAR_PATH_PATTERN.test(text) || TILDE_PATH_PATTERN.test(text) || GIT_BASH_PATH_PATTERN.test(text)) {
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

function maskValue(value) {
    if (typeof value !== 'string') {
        return '****';
    }
    if (value.length <= 4) {
        return '****';
    }
    return value.slice(0, 4) + '****';
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
            console.error(`- [${hit.type}] ${hit.path}: ${maskValue(hit.value)}`);
        }
        console.error(SCAN_DISCLAIMER);
        process.exit(1);
    }

    console.log('敏感信息扫描通过：未命中敏感模式。');
    console.log(SCAN_DISCLAIMER);
}

if (require.main === module) {
    main();
}

module.exports = {
    scanSensitiveInfo,
    generatePostTemplate,
    maskValue,
};

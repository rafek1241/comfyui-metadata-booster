const textDecoder = new TextDecoder("utf-8");

const MATROSKA_IDS = {
    tags: 0x1254c367,
    tag: 0x7373,
    simpleTag: 0x67c8,
    tagName: 0x45a3,
    tagString: 0x4487,
};

const MP4_CONTAINER_TYPES = new Set(["moov", "udta", "meta", "ilst"]);

function readUint32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function readUint64(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (typeof view.getBigUint64 === "function") {
        return Number(view.getBigUint64(offset, false));
    }

    return readUint32(bytes, offset) * 0x100000000 + readUint32(bytes, offset + 4);
}

function readFourCC(bytes, offset) {
    return String.fromCharCode(
        bytes[offset] ?? 0,
        bytes[offset + 1] ?? 0,
        bytes[offset + 2] ?? 0,
        bytes[offset + 3] ?? 0,
    );
}

function decodeText(bytes, start, end) {
    return textDecoder.decode(bytes.subarray(start, end)).replace(/\0/g, "").trim();
}

function mergeMetadata(target, key, value) {
    const normalizedKey = String(key ?? "").replace(/\0/g, "").trim();
    if (!normalizedKey) {
        return;
    }

    if (value === undefined || value === null || value === "") {
        return;
    }

    if (!(normalizedKey in target)) {
        target[normalizedKey] = value;
        return;
    }

    const existing = target[normalizedKey];
    const existingSerialized = JSON.stringify(existing);
    const valueSerialized = JSON.stringify(value);
    if (existingSerialized === valueSerialized) {
        return;
    }

    if (Array.isArray(existing)) {
        if (!existing.some((item) => JSON.stringify(item) === valueSerialized)) {
            existing.push(value);
        }
        return;
    }

    target[normalizedKey] = [existing, value];
}

function readEbmlId(bytes, offset) {
    if (offset >= bytes.length) {
        return null;
    }

    const firstByte = bytes[offset];
    if (!firstByte) {
        return null;
    }

    let mask = 0x80;
    let length = 1;
    while (length <= 4 && (firstByte & mask) === 0) {
        mask >>= 1;
        length += 1;
    }

    if (length > 4 || offset + length > bytes.length) {
        return null;
    }

    let value = 0;
    for (let index = 0; index < length; index += 1) {
        value = value * 256 + bytes[offset + index];
    }

    return { length, value };
}

function readEbmlVint(bytes, offset) {
    if (offset >= bytes.length) {
        return null;
    }

    const firstByte = bytes[offset];
    if (!firstByte) {
        return null;
    }

    let mask = 0x80;
    let length = 1;
    while (length <= 8 && (firstByte & mask) === 0) {
        mask >>= 1;
        length += 1;
    }

    if (length > 8 || offset + length > bytes.length) {
        return null;
    }

    let value = firstByte & (mask - 1);
    let maxValue = mask - 1;
    for (let index = 1; index < length; index += 1) {
        value = value * 256 + bytes[offset + index];
        maxValue = maxValue * 256 + 255;
    }

    if (value === maxValue) {
        return {
            length,
            value: bytes.length - (offset + length),
            unknown: true,
        };
    }

    return { length, value };
}

function parseSimpleTag(bytes, start, end, metadata) {
    let offset = start;
    let name = "";
    let value = null;

    while (offset < end) {
        const idInfo = readEbmlId(bytes, offset);
        if (!idInfo) {
            return;
        }

        offset += idInfo.length;
        const sizeInfo = readEbmlVint(bytes, offset);
        if (!sizeInfo) {
            return;
        }

        offset += sizeInfo.length;
        const dataStart = offset;
        const dataEnd = Math.min(end, dataStart + sizeInfo.value);

        if (idInfo.value === MATROSKA_IDS.tagName) {
            name = decodeText(bytes, dataStart, dataEnd);
        } else if (idInfo.value === MATROSKA_IDS.tagString) {
            value = decodeText(bytes, dataStart, dataEnd);
        } else if (idInfo.value === MATROSKA_IDS.simpleTag) {
            parseSimpleTag(bytes, dataStart, dataEnd, metadata);
        }

        offset = dataEnd;
    }

    mergeMetadata(metadata, name, value);
}

function parseMatroskaElements(bytes, start, end, metadata) {
    let offset = start;

    while (offset < end) {
        const idInfo = readEbmlId(bytes, offset);
        if (!idInfo) {
            return;
        }

        offset += idInfo.length;
        const sizeInfo = readEbmlVint(bytes, offset);
        if (!sizeInfo) {
            return;
        }

        offset += sizeInfo.length;
        const dataStart = offset;
        const dataEnd = Math.min(end, dataStart + sizeInfo.value);

        if (idInfo.value === MATROSKA_IDS.simpleTag) {
            parseSimpleTag(bytes, dataStart, dataEnd, metadata);
        } else if (
            idInfo.value === MATROSKA_IDS.tags ||
            idInfo.value === MATROSKA_IDS.tag
        ) {
            parseMatroskaElements(bytes, dataStart, dataEnd, metadata);
        }

        offset = dataEnd;
    }
}

function parseMp4DataBox(bytes, start, end) {
    const payloadStart = Math.min(end, start + 8);
    return decodeText(bytes, payloadStart, end);
}

function normalizeMp4Key(type, keyIndex, entryName, keysByIndex) {
    if (entryName) {
        return entryName;
    }

    if (keysByIndex.has(keyIndex)) {
        return keysByIndex.get(keyIndex);
    }

    if (type === "----") {
        return "";
    }

    return String(type ?? "").replace(/\0/g, "").trim();
}

function parseMp4MetadataEntry(bytes, start, end) {
    let offset = start;
    let dataValue = null;
    let entryName = "";

    while (offset + 8 <= end) {
        let size = readUint32(bytes, offset);
        let headerSize = 8;
        const type = readFourCC(bytes, offset + 4);

        if (size === 1) {
            size = readUint64(bytes, offset + 8);
            headerSize = 16;
        } else if (size === 0) {
            size = end - offset;
        }

        if (size < headerSize || offset + size > end) {
            return { entryName, dataValue };
        }

        const contentStart = offset + headerSize;
        const contentEnd = offset + size;

        if (type === "data") {
            dataValue = parseMp4DataBox(bytes, contentStart, contentEnd);
        } else if (type === "mean" || type === "name") {
            const text = decodeText(bytes, contentStart + 4, contentEnd);
            if (type === "name") {
                entryName = text;
            }
        }

        offset += size;
    }

    return { entryName, dataValue };
}

function parseMp4Ilst(bytes, start, end, metadata, keysByIndex) {
    let offset = start;

    while (offset + 8 <= end) {
        let size = readUint32(bytes, offset);
        let headerSize = 8;
        const type = readFourCC(bytes, offset + 4);
        const keyIndex = readUint32(bytes, offset + 4);

        if (size === 1) {
            size = readUint64(bytes, offset + 8);
            headerSize = 16;
        } else if (size === 0) {
            size = end - offset;
        }

        if (size < headerSize || offset + size > end) {
            return;
        }

        const contentStart = offset + headerSize;
        const contentEnd = offset + size;
        const entry = parseMp4MetadataEntry(bytes, contentStart, contentEnd);
        const key = normalizeMp4Key(type, keyIndex, entry.entryName, keysByIndex);
        mergeMetadata(metadata, key, entry.dataValue);

        offset += size;
    }
}

function parseMp4Keys(bytes, start, end, keysByIndex) {
    let offset = start + 4;
    if (offset + 4 > end) {
        return;
    }

    const entryCount = readUint32(bytes, offset);
    offset += 4;

    for (let index = 0; index < entryCount && offset + 8 <= end; index += 1) {
        const size = readUint32(bytes, offset);
        if (size < 8 || offset + size > end) {
            return;
        }

        const keyName = decodeText(bytes, offset + 8, offset + size);
        keysByIndex.set(index + 1, keyName);
        offset += size;
    }
}

function parseMp4Boxes(bytes, start, end, metadata, keysByIndex) {
    let offset = start;

    while (offset + 8 <= end) {
        let size = readUint32(bytes, offset);
        let headerSize = 8;
        const type = readFourCC(bytes, offset + 4);

        if (size === 1) {
            size = readUint64(bytes, offset + 8);
            headerSize = 16;
        } else if (size === 0) {
            size = end - offset;
        }

        if (size < headerSize || offset + size > end) {
            return;
        }

        const contentStart = offset + headerSize;
        const contentEnd = offset + size;

        if (type === "keys") {
            parseMp4Keys(bytes, contentStart, contentEnd, keysByIndex);
        } else if (type === "ilst") {
            parseMp4Ilst(bytes, contentStart, contentEnd, metadata, keysByIndex);
        } else if (type === "meta") {
            parseMp4Boxes(bytes, contentStart + 4, contentEnd, metadata, keysByIndex);
        } else if (MP4_CONTAINER_TYPES.has(type)) {
            parseMp4Boxes(bytes, contentStart, contentEnd, metadata, keysByIndex);
        }

        offset += size;
    }
}

export function parseEmbeddedVideoMetadata(arrayBuffer, format) {
    const bytes = new Uint8Array(arrayBuffer);
    const metadata = {};

    if (format === "webm" || format === "mkv") {
        parseMatroskaElements(bytes, 0, bytes.length, metadata);
        return metadata;
    }

    if (format === "mp4" || format === "mov" || format === "m4v") {
        parseMp4Boxes(bytes, 0, bytes.length, metadata, new Map());
        return metadata;
    }

    return metadata;
}

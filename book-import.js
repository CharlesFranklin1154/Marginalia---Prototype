(function (root) {
  function normalizeText(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\f/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function decodeTextFile(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  }

  function detectChapters(value, fallbackTitle) {
    const text = normalizeText(value);
    if (!text) throw new Error('The selected file contains no readable text.');
    const lines = text.split('\n');
    const headings = [];
    const headingPattern = /^\s*(chapter|chap\.?)\s+((?:\d{1,3}|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|thirty|forty|fifty|sixty|seventy|eighty|ninety|prologue|epilogue)(?:\s*(?:[:.\-–—]\s*|\s+).{0,80})?)\s*$/i;
    lines.forEach((line, index) => {
      const match = line.match(headingPattern);
      if (match && match[2].length <= 100) {
        headings.push({ index, title: `Chapter ${match[2].trim()}` });
      }
    });

    if (!headings.length) {
      return [{
        title: String(fallbackTitle || 'Imported chapter').replace(/\.[^.]+$/, '').trim() || 'Imported chapter',
        text,
      }];
    }

    const chapters = [];
    if (headings[0].index > 0) {
      const introduction = lines.slice(0, headings[0].index).join('\n').trim();
      if (introduction) chapters.push({ title: 'Introduction', text: introduction });
    }
    headings.forEach((heading, index) => {
      const end = index + 1 < headings.length ? headings[index + 1].index : lines.length;
      const body = lines.slice(heading.index + 1, end).join('\n').trim();
      if (body) chapters.push({ title: heading.title, text: body });
    });
    return chapters.length ? chapters : [{ title: 'Imported chapter', text }];
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function xmlText(value) {
    return decodeXml(String(value || '')
      .replace(/<(?:w:)?tab\b[^>]*\/?>/gi, '\t')
      .replace(/<(?:w:)?(?:br|cr)\b[^>]*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ''))
      .replace(/[ \t]+\n/g, '\n');
  }

  function zipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lowerBound = Math.max(0, bytes.length - 65557);
    let endOffset = -1;
    for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) {
        endOffset = offset;
        break;
      }
    }
    if (endOffset < 0) throw new Error('This archive is incomplete or not a supported file.');

    const entryCount = view.getUint16(endOffset + 10, true);
    let cursor = view.getUint32(endOffset + 16, true);
    const decoder = new TextDecoder();
    const entries = new Map();
    let totalUncompressedSize = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) {
        throw new Error('This archive contains an invalid directory.');
      }
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      totalUncompressedSize += uncompressedSize;
      if (totalUncompressedSize > 100 * 1024 * 1024) {
        throw new Error('This archive is too large to safely import.');
      }
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }

    return {
      async text(name) {
        const entry = entries.get(name);
        if (!entry) throw new Error(`The archive is missing ${name}.`);
        if (entry.uncompressedSize > 100 * 1024 * 1024) {
          throw new Error('This archive entry is too large to safely import.');
        }
        const local = entry.localOffset;
        if (view.getUint32(local, true) !== 0x04034b50) {
          throw new Error('This archive contains an invalid file entry.');
        }
        const nameLength = view.getUint16(local + 26, true);
        const extraLength = view.getUint16(local + 28, true);
        const start = local + 30 + nameLength + extraLength;
        const content = bytes.slice(start, start + entry.compressedSize);
        if (entry.method === 0) {
          if (content.byteLength !== entry.uncompressedSize) {
            throw new Error('An archive entry could not be read completely.');
          }
          return decoder.decode(content);
        }
        if (entry.method !== 8 || typeof DecompressionStream !== 'function') {
          throw new Error('This compressed file cannot be read in this browser.');
        }
        const stream = new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const reader = stream.getReader();
        const chunks = [];
        let totalBytes = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          totalBytes += result.value.byteLength;
          if (totalBytes > 100 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('This archive entry is too large to safely import.');
          }
          chunks.push(result.value);
        }
        if (totalBytes !== entry.uncompressedSize) {
          throw new Error('An archive entry could not be decompressed completely.');
        }
        const contentBuffer = new Uint8Array(totalBytes);
        let offset = 0;
        chunks.forEach(chunk => {
          contentBuffer.set(chunk, offset);
          offset += chunk.byteLength;
        });
        return decoder.decode(contentBuffer);
      },
      has(name) {
        return entries.has(name);
      },
      names() {
        return Array.from(entries.keys());
      },
    };
  }

  async function extractDocx(buffer) {
    const archive = zipEntries(buffer);
    const documentXml = await archive.text('word/document.xml');
    const paragraphs = documentXml.match(/<(?:\w+:)?p\b[^>]*>[\s\S]*?<\/(?:\w+:)?p>/gi) || [];
    return normalizeText(paragraphs.map(xmlText).join('\n'));
  }

  function readAttribute(attributes, name) {
    const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return match ? decodeXml(match[1]) : '';
  }

  function resolveArchivePath(base, relative) {
    const cleanRelative = String(relative || '').split(/[?#]/, 1)[0];
    const parts = `${base}${cleanRelative}`.split('/');
    const resolved = [];
    parts.forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') resolved.pop();
      else resolved.push(decodeURIComponent(part));
    });
    return resolved.join('/');
  }

  async function extractEpub(buffer) {
    const archive = zipEntries(buffer);
    const container = await archive.text('META-INF/container.xml');
    const rootfile = container.match(/<rootfile\b([^>]*?)\/?>/i);
    const packagePath = rootfile && readAttribute(rootfile[1], 'full-path');
    if (!packagePath) throw new Error('The EPUB package manifest could not be found.');
    const packageXml = await archive.text(packagePath);
    const basePath = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';
    const manifest = new Map();
    const itemPattern = /<item\b([^>]*?)\/?>/gi;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(packageXml))) {
      const id = readAttribute(itemMatch[1], 'id');
      const href = readAttribute(itemMatch[1], 'href');
      if (id && href) manifest.set(id, resolveArchivePath(basePath, href));
    }
    const spine = [];
    const itemRefPattern = /<itemref\b([^>]*?)\/?>/gi;
    let itemRef;
    while ((itemRef = itemRefPattern.exec(packageXml))) {
      const path = manifest.get(readAttribute(itemRef[1], 'idref'));
      if (path && archive.has(path)) spine.push(path);
    }
    if (!spine.length) throw new Error('The EPUB has no readable chapters in its spine.');
    const sections = [];
    for (const path of spine) {
      const html = await archive.text(path);
      const body = html
        .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(?:h[1-6]|p|div|li|blockquote|br)\b[^>]*>/gi, '\n')
        .replace(/<\/(?:h[1-6]|p|div|li|blockquote)\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '');
      const sectionText = normalizeText(decodeXml(body));
      if (sectionText) sections.push(sectionText);
    }
    return normalizeText(sections.join('\n\n'));
  }

  async function extractFile(file) {
    const extension = String(file && file.name || '').split('.').pop().toLowerCase();
    if (extension === 'txt' || extension === 'md' || extension === 'text') {
      return normalizeText(decodeTextFile(await file.arrayBuffer()));
    }
    if (extension === 'docx' || extension === 'epub') {
      const buffer = await file.arrayBuffer();
      return extension === 'docx' ? extractDocx(buffer) : extractEpub(buffer);
    }
    if (extension === 'pdf') {
      throw new Error('PDF import is not supported yet. Export a text-based PDF to DOCX or copy its text into a TXT file, then import that file.');
    }
    throw new Error('Choose a TXT, Markdown, DOCX, or EPUB file.');
  }

  const api = { normalizeText, decodeTextFile, detectChapters, extractDocx, extractEpub, extractFile };
  root.MarginaliaBookImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));

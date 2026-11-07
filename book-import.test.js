const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodeTextFile, detectChapters, extractDocx, extractEpub, extractFile, normalizeText } = require('./book-import.js');

function storedZip(entries, compress = false) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const rawBytes = Buffer.from(content);
    const contentBytes = compress ? zlib.deflateRawSync(rawBytes) : rawBytes;
    const local = Buffer.alloc(30 + nameBytes.length + contentBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(contentBytes.length, 18);
    local.writeUInt32LE(rawBytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    contentBytes.copy(local, 30 + nameBytes.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(contentBytes.length, 20);
    central.writeUInt32LE(rawBytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

assert.equal(normalizeText('\uFEFFOne\r\nTwo\fThree'), 'One\nTwo\nThree');
assert.equal(decodeTextFile(Buffer.from([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])), 'AB');
assert.equal(decodeTextFile(Buffer.from([0x63, 0x61, 0x66, 0xe9])), 'café');

const chapters = detectChapters(
  'Foreword text.\n\nChapter 1: Arrival\nA first event.\n\nChapter II\nA second event.',
  'Manuscript.txt',
);
assert.deepEqual(chapters.map(chapter => chapter.title), [
  'Introduction',
  'Chapter 1: Arrival',
  'Chapter II',
]);
assert.equal(chapters[1].text, 'A first event.');
assert.equal(chapters[2].text, 'A second event.');

const singleChapter = detectChapters('Text without chapter headings.', 'My Book.docx');
assert.equal(singleChapter.length, 1);
assert.equal(singleChapter[0].title, 'My Book');
assert.equal(singleChapter[0].text, 'Text without chapter headings.');

const excerpt = detectChapters('Chapter 6: The Windmill\nChapter text.', 'Excerpt.txt');
assert.deepEqual(excerpt, [{ title: 'Chapter 6: The Windmill', text: 'Chapter text.' }]);
assert.equal(detectChapters('Chapter text.', 'Notes.txt')[0].title, 'Notes');
assert.equal(detectChapters('Chapter 12\nLast chapter.', 'Book.txt')[0].title, 'Chapter 12');

async function testArchiveReaders() {
  const docx = storedZip({
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Chapter 1</w:t></w:r></w:p><w:p><w:r><w:t>Text &amp; evidence.</w:t></w:r></w:p></w:body></w:document>',
  }, true);
  assert.equal(await extractDocx(docx), 'Chapter 1\nText & evidence.');

  const epub = storedZip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
    'OPS/package.opf': '<package><manifest><item id="c1" href="chapter1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>',
    'OPS/chapter1.xhtml': '<html><body><h1>Chapter 1</h1><p>Text &amp; evidence.</p></body></html>',
  });
  assert.equal(await extractEpub(epub), 'Chapter 1\n\nText & evidence.');
  await assert.rejects(() => extractFile({ name: 'scan.pdf' }), /PDF import is not supported yet/);
}

testArchiveReaders().then(() => console.log('Book import helper tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

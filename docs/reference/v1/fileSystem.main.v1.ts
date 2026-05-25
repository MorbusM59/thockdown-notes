import * as fs from 'fs/promises';
import * as path from 'path';
import { getNotesDir } from './paths';

// Minimal CP1252 mapping for bytes 0x80-0x9F to Unicode.
const CP1252_MAP: { [b: number]: string } = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
  0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
  0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
  0x9E: '\u017E', 0x9F: '\u0178'
};

function decodeCp1252(buf: Buffer): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x00 && b <= 0x7F) {
      out += String.fromCharCode(b);
    } else if (b >= 0xA0 && b <= 0xFF) {
      out += String.fromCharCode(b);
    } else if (CP1252_MAP[b]) {
      out += CP1252_MAP[b];
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

/**
 * Read `filePath`, detect likely UTF-8 decoding issues (replacement char),
 * and if found attempt to decode as CP1252 and rewrite the file as UTF-8.
 * Returns the normalized UTF-8 string content.
 */
export async function normalizeFileEncoding(filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);

    // Check for UTF-16LE BOM
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      return buf.toString('utf16le');
    }
    // Check for UTF-16BE BOM (less common, but handled via byte swapping)
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      return buf.swap16().toString('utf16le');
    }
    // Check for UTF-8 BOM
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      return buf.slice(3).toString('utf8');
    }

    // Try UTF-8 first
    const asUtf8 = buf.toString('utf8');
    if (!asUtf8.includes('\uFFFD')) return asUtf8;

    // Fallback: decode as CP1252 and write back as UTF-8
    const decoded = decodeCp1252(buf);
    try {
      await fs.writeFile(filePath, decoded, 'utf8');
    } catch (err) {
      // ignore write errors
    }
    return decoded;
  } catch (err) {
    return '';
  }
}

export async function initFileSystem(): Promise<void> {
  const notesDir = getNotesDir();
  try {
    await fs.access(notesDir);
  } catch {
    await fs.mkdir(notesDir, { recursive: true });
  }
}

export async function saveNoteContent(noteId: number, content: string, destFileName?: string): Promise<string> {
  const notesDir = getNotesDir();
  const filePath = destFileName ? path.join(notesDir, destFileName) : path.join(notesDir, `${noteId}.md`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function copyFileToNotes(srcPath: string, destFileName: string): Promise<string> {
  const notesDir = getNotesDir();
  const dest = path.join(notesDir, destFileName);
  await fs.copyFile(srcPath, dest);
  return dest;
}

export async function loadNoteContent(filePath: string): Promise<string> {
  try {
    return await normalizeFileEncoding(filePath);
  } catch {
    return '';
  }
}

export async function deleteNoteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error('Error deleting note file:', error);
  }
}

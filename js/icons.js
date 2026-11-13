// Bộ biểu tượng SVG (nét 1.75, kiểu Lucide) — thay cho emoji để giao diện nhất quán trên mọi máy.
const P = {
  vault: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8V7.5M12 16.5v-1.3M15.2 12h1.3M7.5 12h1.3M7 20v1.5M17 20v1.5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.5.7l1.1 1.3a2 2 0 0 0 1.5.7h5.3A2.5 2.5 0 0 1 21 10.2v6.3a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z"/>',
  folderOpen: '<path d="M4 19.2 6.3 11.6A2 2 0 0 1 8.2 10.2H20a1.2 1.2 0 0 1 1.15 1.55l-2.1 6.5A2 2 0 0 1 17.1 19.7H5.5A2.5 2.5 0 0 1 3 17.2V7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.5.7l1.1 1.3a2 2 0 0 0 1.5.7h3.8A2.5 2.5 0 0 1 19.5 10"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/>',
  move: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.5.7l1.1 1.3a2 2 0 0 0 1.5.7h5.3A2.5 2.5 0 0 1 21 10.2v6.3a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z"/><path d="M10 13h5m0 0-2-2m2 2-2 2"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9.5 7V5h5v2M6.5 7l.8 12.2A1.5 1.5 0 0 0 8.8 20.6h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6"/>',
  upload: '<path d="M12 16V5m0 0-4.5 4.5M12 5l4.5 4.5M5 19.5h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5Z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6M5 12v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6"/>',
};

export function icon(name, cls = '') {
  const s = document.createElement('span');
  s.className = 'i ' + cls;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
  return s;
}

const KINDS = [
  [/^image\//, 'IMG', 'k-img'], [/^video\//, 'VID', 'k-vid'], [/^audio\//, 'AUD', 'k-aud'],
  [/pdf/, 'PDF', 'k-pdf'], [/word|document|rtf/, 'DOC', 'k-doc'], [/sheet|excel|csv/, 'XLS', 'k-xls'],
  [/presentation|powerpoint/, 'PPT', 'k-ppt'], [/zip|rar|7z|tar|gzip|compressed/, 'ZIP', 'k-zip'], [/^text\/|json|xml/, 'TXT', 'k-txt'],
];

/** Biểu tượng loại tệp: ô màu kèm phần mở rộng (giống trình quản lý tệp). */
export function fileBadge(entry) {
  const m = entry.mime || '';
  const ext = (entry.name.includes('.') ? entry.name.split('.').pop() : '').slice(0, 4).toUpperCase();
  const k = KINDS.find(([re]) => re.test(m));
  const b = document.createElement('span');
  b.className = 'fb ' + (k ? k[2] : 'k-other');
  b.textContent = ext || (k ? k[1] : 'FILE');
  if (b.textContent.length > 3) b.classList.add('long');
  return b;
}

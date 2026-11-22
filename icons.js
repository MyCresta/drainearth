const paths = {
  layers:'<path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>', drop:'<path d="M12 3s-7 8.2-7 12a7 7 0 0 0 14 0c0-3.8-7-12-7-12Z"/>',
  bottle:'<path d="m13 3 5 3m-4-2-3 5a4 4 0 0 0-4 2l-4 7a2 2 0 0 0 1 3l3 1a2 2 0 0 0 3-1l5-8a4 4 0 0 0 0-4l2-4M7 13l5 3"/>',
  target:'<circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M22 12h-4M12 22v-4M2 12h4"/>',
  edit:'<path d="m15 5 4 4M4 20l4.8-1 11-11a2.8 2.8 0 0 0-4-4l-11 11z"/>',
  drain:'<path d="M12 2v10m-4-4 4 4 4-4M3 16c3-2.6 5.9 2.6 9 0s6 2.6 9 0M3 20c3-2.6 5.9 2.6 9 0s6 2.6 9 0"/>',
  reset:'<path d="M4 4v5h5M4.5 8.3a8 8 0 1 1-.2 7"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11s-7-6-7-11a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
  mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.5"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',shrink:'<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',play:'<path d="m8 4 11 8-11 8z"/>',check:'<path d="m4 12 5 5L20 6"/>'
};
export const icon = name => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';

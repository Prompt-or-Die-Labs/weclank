// Inline SVG icon strings. Using strings (vs JSX) keeps everything in the
// vanilla-TS template() pattern. All icons inherit currentColor so styling
// happens at the parent.

const svg = (paths: string, size = 20): string =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const Icons = {
	back: (s = 20) => svg('<path d="M15 18l-6-6 6-6"/>', s),
	calendar: (s = 18) =>
		svg(
			'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
			s,
		),
	chevronDown: (s = 14) => svg('<path d="M6 9l6 6 6-6"/>', s),
	plus: (s = 18) => svg('<path d="M12 5v14M5 12h14"/>', s),
	expand: (s = 16) =>
		svg(
			'<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
			s,
		),
	minimize: (s = 16) =>
		svg(
			'<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
			s,
		),
	more: (s = 16) =>
		svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', s),
	eye: (s = 16) =>
		svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>', s),
	eyeOff: (s = 16) =>
		svg('<path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a20.7 20.7 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.8 10.8 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-3.22 4.16"/><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/>', s),
	layoutSwap: (s = 16) =>
		svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', s),
	window: (s = 16) =>
		svg('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="4" x2="8" y2="9"/>', s),
	radio: (s = 16) =>
		svg('<path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M8.4 15.6a5 5 0 0 1 0-7.1"/><circle cx="12" cy="12" r="2"/><path d="M15.6 8.4a5 5 0 0 1 0 7.1"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>', s),
	phone: (s = 16) =>
		svg('<rect x="6" y="2" width="12" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/>', s),
	monitor: (s = 16) =>
		svg('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', s),
	mic: (s = 18) =>
		svg(
			'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
			s,
		),
	micOff: (s = 18) =>
		svg(
			'<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
			s,
		),
	camera: (s = 18) =>
		svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>', s),
	cameraOff: (s = 18) =>
		svg('<line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 1 1 9.34 5.34"/>', s),
	screen: (s = 18) =>
		svg('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', s),
	image: (s = 18) =>
		svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>', s),
	folder: (s = 18) =>
		svg('<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', s),
	bot: (s = 18) =>
		svg('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M9 18h6"/>', s),
	inviteUser: (s = 18) =>
		svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>', s),
	settings: (s = 18) =>
		svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', s),
	key: (s = 18) =>
		svg('<circle cx="7.5" cy="14.5" r="4.5"/><path d="M11 11l10-10"/><path d="M17 5l2 2"/><path d="M14 8l2 2"/>', s),
	logOut: (s = 18) =>
		svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>', s),
	trash: (s = 18) =>
		svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>', s),
	user: (s = 18) =>
		svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', s),
	chat: (s = 18) =>
		svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', s),
	notes: (s = 18) =>
		svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>', s),
	copy: (s = 18) =>
		svg('<rect x="9" y="9" width="12" height="12" rx="2"/><rect x="3" y="3" width="12" height="12" rx="2"/>', s),
	download: (s = 18) =>
		svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>', s),
	graphics: (s = 18) =>
		svg('<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20 4 4 0 0 0 4-4 4 4 0 0 0-4-4h-2a2 2 0 0 1 0-4h6a6 6 0 0 0-4-8z"/>', s),
	qr: (s = 18) =>
		svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="17"/><line x1="17" y1="14" x2="17" y2="21"/><line x1="20" y1="17" x2="14" y2="17"/><line x1="20" y1="21" x2="20" y2="21"/>', s),
	captions: (s = 18) =>
		svg('<path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7 13a2 2 0 0 0 4 0M13 13a2 2 0 0 0 4 0"/>', s),
	music: (s = 18) =>
		svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', s),
	theme: (s = 18) =>
		svg('<path d="M2 12a10 10 0 1 0 20 0 4 4 0 0 0-4-4h-2a2 2 0 0 1 0-4 4 4 0 0 0-4-4 10 10 0 0 0-10 12z"/>', s),
	help: (s = 18) =>
		svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>', s),
	private: (s = 18) =>
		svg('<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', s),
	edit: (s = 14) =>
		svg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>', s),
	fullscreen: (s = 14) =>
		svg('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>', s),
};

// Streaming-platform brand glyphs. Most paths come from simple-icons.org
// (CC0/MIT-licensed) and use a 24x24 viewBox. Crypto-native brands
// (pump.fun, retake.tv) ship their own SVGs which we trace into single-
// path silhouettes with a custom viewBox. Rendered as filled shapes via
// currentColor so the chip system can color them.
const brandSvg = (paths: string, size: number, viewBox = "0 0 24 24"): string =>
	`<svg width="${size}" height="${size}" viewBox="${viewBox}" fill="currentColor" stroke="none" aria-hidden="true">${paths}</svg>`;

const BRAND_PATHS = {
	twitch:    "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
	youtube:   "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
	facebook:  "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
	kick:      "M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z",
	rumble:    "M14.4528 13.5458c.8064-.6542.9297-1.8381.2756-2.6445a1.8802 1.8802 0 0 0-.2756-.2756 21.2127 21.2127 0 0 0-4.3121-2.776c-1.066-.51-2.256.2-2.4261 1.414a23.5226 23.5226 0 0 0-.14 5.5021c.116 1.23 1.292 1.964 2.372 1.492a19.6285 19.6285 0 0 0 4.5062-2.704v-.008zm6.9322-5.4002c2.0335 2.228 2.0396 5.637.014 7.8723A26.1487 26.1487 0 0 1 8.2946 23.846c-2.6848.6713-5.4168-.914-6.1662-3.5781-1.524-5.2002-1.3-11.0803.17-16.3045.772-2.744 3.3521-4.4661 6.0102-3.832 4.9242 1.174 9.5443 4.196 13.0764 8.0121v.002z",
	x:         "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
	tiktok:    "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
	instagram: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
	// LinkedIn's mark, used here under fair-use as a UI label.
	linkedin:  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
	// pump.fun's logomark — the green pill silhouette from their official
	// SVG at pump.fun/pump-logomark.svg. Outer path traced verbatim; the
	// interior detail dots are dropped so the mark reads cleanly at 16px.
	pumpfun:   "M21.8855 184.247C-2.01603 162.076 -3.41853 124.726 18.753 100.824L94.7609 18.8855C116.932 -5.01605 154.282 -6.41855 178.184 15.7529C202.085 37.9244 203.488 75.274 181.316 99.1756L105.308 181.115C83.1367 205.016 45.7871 206.419 21.8855 184.247Z",
	// retake.tv's mark: chunky "TV" letters with the V's right stroke
	// extending up-right into a chart arrow. Traced from the user-
	// supplied retaketv.svg. Single filled silhouette so it themes
	// cleanly via currentColor.
	retaketv:  "M2.5 5.5h8.5v3H8.7V20H5.8V8.5H2.5zm9 0h2.6l1.85 8.1 1.3-5.85 2.65 1.55-.95 1.6-.9-.55-1.95 9.65H13.5zm9.6-2.2 1.9 4.8-1.6 1.3-.9-1.05-2.6 3.05-1.45-1.25 2.6-3.05-1.05-.85z",
} as const;

/** Some brand paths use a non-default viewBox — chiefly pump.fun whose
 * official logomark is authored at 200x200. Defaults to "0 0 24 24". */
const BRAND_VIEWBOX: Partial<Record<keyof typeof BRAND_PATHS, string>> = {
	pumpfun: "0 0 200 200",
};

export type BrandId = keyof typeof BRAND_PATHS;

export const Brands = {
	twitch:    (s = 16) => brandSvg(`<path d="${BRAND_PATHS.twitch}"/>`, s, BRAND_VIEWBOX.twitch),
	youtube:   (s = 16) => brandSvg(`<path d="${BRAND_PATHS.youtube}"/>`, s, BRAND_VIEWBOX.youtube),
	facebook:  (s = 16) => brandSvg(`<path d="${BRAND_PATHS.facebook}"/>`, s, BRAND_VIEWBOX.facebook),
	kick:      (s = 16) => brandSvg(`<path d="${BRAND_PATHS.kick}"/>`, s, BRAND_VIEWBOX.kick),
	rumble:    (s = 16) => brandSvg(`<path d="${BRAND_PATHS.rumble}"/>`, s, BRAND_VIEWBOX.rumble),
	x:         (s = 16) => brandSvg(`<path d="${BRAND_PATHS.x}"/>`, s, BRAND_VIEWBOX.x),
	tiktok:    (s = 16) => brandSvg(`<path d="${BRAND_PATHS.tiktok}"/>`, s, BRAND_VIEWBOX.tiktok),
	instagram: (s = 16) => brandSvg(`<path d="${BRAND_PATHS.instagram}"/>`, s, BRAND_VIEWBOX.instagram),
	linkedin:  (s = 16) => brandSvg(`<path d="${BRAND_PATHS.linkedin}"/>`, s, BRAND_VIEWBOX.linkedin),
	pumpfun:   (s = 16) => brandSvg(`<path d="${BRAND_PATHS.pumpfun}"/>`, s, BRAND_VIEWBOX.pumpfun),
	retaketv:  (s = 16) => brandSvg(`<path d="${BRAND_PATHS.retaketv}"/>`, s, BRAND_VIEWBOX.retaketv),
};

/** Hex brand colors. Used as the active-state fill on channel circles. */
export const BRAND_COLORS: Record<BrandId, string> = {
	twitch:    "#9146FF",
	youtube:   "#FF0000",
	facebook:  "#1877F2",
	kick:      "#53FC18",
	rumble:    "#85C742",
	x:         "#000000",
	tiktok:    "#000000",
	instagram: "#E4405F",
	linkedin:  "#0A66C2",
	pumpfun:   "#5FCB88",
	retaketv:  "#4FE89C",
};

/** Human-readable platform names (display labels and screen-reader text). */
export const BRAND_LABELS: Record<BrandId, string> = {
	twitch:    "Twitch",
	youtube:   "YouTube",
	facebook:  "Facebook",
	kick:      "Kick",
	rumble:    "Rumble",
	x:         "X",
	tiktok:    "TikTok",
	instagram: "Instagram",
	linkedin:  "LinkedIn",
	pumpfun:   "pump.fun",
	retaketv:  "retake.tv",
};

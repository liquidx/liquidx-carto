import type { OdptAccess, OdptGtfsFeed } from './catalog.ts';

const HOSTS: Record<OdptAccess, string> = {
	public: 'https://api-public.odpt.org/api/v4',
	basic: 'https://api.odpt.org/api/v4',
	challenge: 'https://api-challenge.odpt.org/api/v4'
};

export type OdptClientOptions = {
	/** Access token from developer.odpt.org (basic license data). */
	token?: string;
	/** Access token from the Open Data Challenge site; falls back to `token`. */
	challengeToken?: string;
	fetch?: typeof fetch;
};

export class OdptError extends Error {
	status: number;
	url: string;
	constructor(status: number, url: string, message: string) {
		super(message);
		this.status = status;
		this.url = url;
	}
}

export type OdptFile = {
	bytes: Uint8Array;
	/** URL without the access token, safe to log or store. */
	url: string;
	lastModified?: string;
	etag?: string;
};

/**
 * Client for the ODPT (公共交通オープンデータセンター) API v4.
 * Files (GTFS zips) live under /files/…; JSON-LD data under /odpt:<Type>.
 */
export class OdptClient {
	private token?: string;
	private challengeToken?: string;
	private fetchImpl: typeof fetch;

	constructor(opts: OdptClientOptions = {}) {
		this.token = opts.token || undefined;
		this.challengeToken = opts.challengeToken || opts.token || undefined;
		this.fetchImpl = opts.fetch ?? fetch;
	}

	/** Whether a token for this access tier is configured. */
	canAccess(access: OdptAccess): boolean {
		return access === 'public' || !!this.tokenFor(access);
	}

	/** Build a request URL for an access tier, adding the matching token. */
	url(access: OdptAccess, path: string, params: Record<string, string> = {}): URL {
		const url = new URL(`${HOSTS[access]}/${path.replace(/^\//, '')}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		if (access !== 'public') {
			const token = this.tokenFor(access);
			if (!token) throw new OdptError(0, url.href, `No ODPT ${access} access token configured`);
			url.searchParams.set('acl:consumerKey', token);
		}
		return url;
	}

	/** Download a file (e.g. a GTFS zip). ODPT redirects to a short-lived blob URL. */
	async file(access: OdptAccess, path: string): Promise<OdptFile> {
		const url = this.url(access, `files/${path}`);
		const res = await this.request(url);
		return {
			bytes: new Uint8Array(await res.arrayBuffer()),
			url: redact(url),
			lastModified: res.headers.get('last-modified') ?? undefined,
			etag: res.headers.get('etag') ?? undefined
		};
	}

	gtfs(feed: OdptGtfsFeed): Promise<OdptFile> {
		return this.file(feed.access, feed.path);
	}

	/**
	 * Query the JSON-LD API, e.g. `query('odpt:Station', { 'odpt:operator': 'odpt.Operator:Toei' })`.
	 * Pass `dump: true` to fetch the whole dataset (`/odpt:Station.json`) regardless of filters.
	 */
	async query<T = OdptObject>(
		type: string,
		params: Record<string, string> = {},
		opts: { access?: OdptAccess; dump?: boolean } = {}
	): Promise<T[]> {
		const t = type.includes(':') ? type : `odpt:${type}`;
		const url = this.url(opts.access ?? 'basic', opts.dump ? `${t}.json` : t, params);
		const res = await this.request(url);
		return (await res.json()) as T[];
	}

	private tokenFor(access: OdptAccess): string | undefined {
		if (access === 'basic') return this.token;
		if (access === 'challenge') return this.challengeToken;
		return undefined;
	}

	private async request(url: URL): Promise<Response> {
		const res = await this.fetchImpl(url, { redirect: 'follow' });
		if (!res.ok) {
			const body = (await res.text()).slice(0, 300);
			const hint =
				res.status === 401 || res.status === 403
					? ' (check the access token and that your account has rights to this dataset)'
					: '';
			throw new OdptError(
				res.status,
				redact(url),
				`ODPT ${res.status} for ${redact(url)}${hint}: ${body}`
			);
		}
		return res;
	}
}

/** A JSON-LD object from the ODPT API. */
export type OdptObject = {
	'@id': string;
	'@type': string;
	'owl:sameAs': string;
	'dc:date'?: string;
	'dc:title'?: string;
	[key: string]: unknown;
};

function redact(url: URL): string {
	const u = new URL(url);
	if (u.searchParams.has('acl:consumerKey')) u.searchParams.set('acl:consumerKey', '***');
	return u.href;
}

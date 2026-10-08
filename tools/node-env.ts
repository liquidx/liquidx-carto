/**
 * Lets a tool run the app's own code under Node: `node --import ./tools/node-env.ts tools/x.ts`.
 *
 * Node strips types but resolves imports as written, so this maps the `$lib/` alias to
 * `src/lib/`, and `./x.js` to `./x.ts` where only the source exists (as in `packages/`, which
 * import with the extensions their built output has). It also fills in `FileReader`, which
 * three.js's GLTFExporter reads its blobs with and Node does not have.
 */
import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const lib = new URL('../src/lib/', import.meta.url);

const isFile = (url: string) => {
	try {
		return statSync(fileURLToPath(url)).isFile();
	} catch {
		return false;
	}
};

registerHooks({
	resolve(specifier, context, next) {
		let url: URL | undefined;
		if (specifier.startsWith('$lib/')) url = new URL(specifier.slice('$lib/'.length), lib);
		else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:'))
			url = new URL(specifier, context.parentURL);
		if (url) {
			const { href } = url;
			for (const candidate of [href, `${href}.ts`, href.replace(/\.js$/, '.ts')])
				if (isFile(candidate)) return { url: candidate, shortCircuit: true };
		}
		return next(specifier, context);
	}
});

if (typeof globalThis.FileReader === 'undefined') {
	/** Just what GLTFExporter uses: `readAsArrayBuffer` then `onloadend`. */
	class FileReader {
		result: ArrayBuffer | null = null;
		onloadend: (() => void) | null = null;
		readAsArrayBuffer(blob: Blob) {
			blob.arrayBuffer().then((buffer) => {
				this.result = buffer;
				this.onloadend?.();
			});
		}
	}
	Object.assign(globalThis, { FileReader });
}

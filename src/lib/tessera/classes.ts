/**
 * What the classifier can be taught to tell apart. Labels carry a class's `id`; a model learns
 * whichever classes have labels (two at least) and keeps their definitions, so a model and the
 * areas it maps still read the same after the list changes. A class with a `kind` is mapped:
 * its areas are traced as scene features of that kind (`wood` is what the dioramas plant trees
 * in), and compared with the scene's own. One without, like open ground, is only there to be
 * told apart from the rest.
 *
 * The list is defined on the /tessera-classifier page, kept in the browser and written into
 * every labels file exported, which is where `pnpm tessera-classifier train` reads it from.
 * These are only the classes it starts with.
 */
export interface LabelClass {
	id: string;
	/** As the labeller shows it. */
	name: string;
	color: string;
	/** The scene feature kind its areas become, when it's mapped. */
	kind?: string;
}

export const DEFAULT_CLASSES: LabelClass[] = [
	{ id: 'woods', name: 'woods', color: '#4cc38a', kind: 'wood' },
	{ id: 'open', name: 'open', color: '#d0a24c' }
];

/** The polygon kinds a scene from `pnpm diorama-scene` has, which a class can be mapped as. */
export const SCENE_KINDS = ['wood', 'water', 'building', 'carpark'];

/** Colours for new classes, in turn, apart from the defaults'. */
const PALETTE = ['#5aa9e6', '#e86a92', '#b48ef0', '#f2c14e', '#7fd1c7', '#e8875a', '#9ad25a'];

/** Labels drawn before the classes had these names. */
const ALIASES: Record<string, string> = { trees: 'woods' };

/** The id a label names, as it's named now. */
export const labelId = (label: string) => ALIASES[label] ?? label;

/** The class a label names, or undefined for one the list doesn't have. */
export function classOf(label: unknown, classes: LabelClass[]): LabelClass | undefined {
	if (typeof label !== 'string') return;
	const id = labelId(label);
	return classes.find((c) => c.id === id);
}

export const isClass = (v: unknown): v is LabelClass =>
	typeof (v as LabelClass)?.id === 'string' &&
	!!(v as LabelClass).id &&
	typeof (v as LabelClass).name === 'string' &&
	typeof (v as LabelClass).color === 'string';

/** An id for a class named `name`, unlike any of the others'. */
export function idFor(name: string, classes: LabelClass[], except?: string) {
	const base =
		name
			.toLowerCase()
			.trim()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-|-$/g, '') || 'class';
	let id = base;
	for (let n = 2; classes.some((c) => c.id === id && c.id !== except); n++) id = `${base}-${n}`;
	return id;
}

/** A new class, named and coloured apart from the others. */
export function newClass(classes: LabelClass[]): LabelClass {
	let n = classes.length + 1;
	while (classes.some((c) => c.name === `class ${n}`)) n++;
	const name = `class ${n}`;
	const used = new Set(classes.map((c) => c.color));
	const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[classes.length % PALETTE.length];
	return { id: idFor(name, classes), name, color };
}

/**
 * The first list with the classes of the others it doesn't have added, as a labels file's or a
 * model's are when they come in.
 */
export function mergeClasses(into: LabelClass[], ...from: LabelClass[][]) {
	const out = [...into];
	for (const list of from) for (const c of list) if (!out.some((o) => o.id === c.id)) out.push(c);
	return out;
}

/** A class for each label id the list doesn't have: a labels file written by hand, say. */
export function classesForLabels(ids: string[], classes: LabelClass[]) {
	let out = classes;
	for (const id of new Set(ids.map(labelId)))
		if (!out.some((c) => c.id === id)) out = [...out, { ...newClass(out), id, name: id }];
	return out;
}

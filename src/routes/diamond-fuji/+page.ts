import { redirect } from '@sveltejs/kit';

// The tool was first published here, as Diamond Fuji.
export const load = () => redirect(308, '/fuji-sun');

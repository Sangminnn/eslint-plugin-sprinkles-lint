import { style, styleVariants } from '@vanilla-extract/css';

export const soloA = style({ minHeight: '100vh' });
export const soloA2 = style({ cursor: 'pointer' });
export const composedB = style({ width: 'auto' });
export const clsxC1 = style({ display: 'flex' });
export const clsxC2 = style({ display: 'block' });
export const condC3 = style({ position: 'relative' });
export const skeletonE = style({ width: '100%' });
export const spreadF = style({ display: 'flex' });
export const reexportedH = style({ display: 'flex' });
export const aliasVia = style({ cursor: 'default' });
export const unusedU = style({ display: 'grid' });
export const aliasOnlyComposed = style({ display: 'flex' });
export const variantsMap = styleVariants({ big: { fontSize: 18 } });
export const localHole = style({ cursor: 'pointer' });
export const intraBase = style({ width: '100%' });
export const intraCard = style([intraBase, { color: 'red' }]);

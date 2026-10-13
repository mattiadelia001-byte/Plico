// Ponte tra i componenti e il Viewer, che possiede lo scroll.
export const viewerApi = {
  scrollToPage: (_page: number, _y?: number) => {},
  /** Centra un rettangolo (coordinate pagina) nella vista. */
  reveal: (_page: number, _rect: [number, number, number, number]) => {},
};

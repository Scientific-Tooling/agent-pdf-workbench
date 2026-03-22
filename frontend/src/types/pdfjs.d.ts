declare module "pdfjs-dist/build/pdf.mjs" {
  export const version: string;
  export const GlobalWorkerOptions: {
    workerSrc: string;
  };
  export function getDocument(src: string): {
    promise: Promise<unknown>;
  };
  export class TextLayer {
    constructor(params: {
      textContentSource: unknown;
      container: HTMLElement;
      viewport: unknown;
    });
    render(): Promise<void>;
    cancel(): void;
    get textDivs(): HTMLElement[];
    get textContentItemsStr(): string[];
  }
}

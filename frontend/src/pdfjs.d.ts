declare module "pdfjs-dist/build/pdf.mjs" {
  export const version: string;
  export const GlobalWorkerOptions: {
    workerSrc: string;
  };
  export function getDocument(src: string): {
    promise: Promise<unknown>;
  };
}

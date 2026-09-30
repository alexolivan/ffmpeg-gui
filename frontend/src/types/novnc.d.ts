declare module '@novnc/novnc/core/rfb' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: any);
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    disconnect(): void;
    sendCredentials(credentials: any): void;
  }
}

declare module '@novnc/novnc' {
  import RFB from '@novnc/novnc/core/rfb';
  export default RFB;
}

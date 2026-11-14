/** Minimal WebXR typing: only what the scan needs (the standard DOM typings do not include it). */
export interface XRPoseLike { transform: { position: { x: number; y: number; z: number } } }
export interface XRHitLike { getPose(space: unknown): XRPoseLike | null | undefined }
export interface XRFrameLike { getHitTestResults(source: unknown): XRHitLike[] }
export interface XRSessionLike {
  requestReferenceSpace(kind: string): Promise<unknown>;
  requestHitTestSource(opts: { space: unknown }): Promise<unknown>;
  requestAnimationFrame(cb: (t: number, frame: XRFrameLike) => void): number;
  updateRenderState(state: { baseLayer: unknown }): void;
  renderState: { baseLayer?: { framebuffer?: WebGLFramebuffer | null } };
  addEventListener(type: 'end', cb: () => void): void;
  end(): Promise<void>;
}
export interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, opts: unknown): Promise<XRSessionLike>;
}

export const xrSystem = (): XRSystemLike | null => (typeof navigator !== 'undefined' ? ((navigator as unknown as { xr?: XRSystemLike }).xr ?? null) : null);

/** Can this browser do an immersive AR session with hit testing (Android Chrome with ARCore)? Never throws. */
export async function arSupported(): Promise<boolean> {
  try {
    const xr = xrSystem();
    if (!xr || !window.isSecureContext) return false;
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

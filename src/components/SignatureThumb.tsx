import type { Signature } from "../engine/annotations";
import { signaturePath } from "../engine/signature";

/** Miniatura di una firma, su fondo bianco come sul foglio. */
export function SignatureThumb(props: { sig: Signature; width?: number; height?: number }) {
  const { sig, width = 96, height = 34 } = props;
  const pad = 4;
  const bw = width - pad * 2, bh = height - pad * 2;
  const scale = Math.min(bw / sig.aspect, bh);
  const w = scale * sig.aspect, h = scale;
  return (
    <span className="sig-thumb-box" style={{ width, height }}>
      {sig.image ? (
        <img src={sig.image} alt="" style={{ width: w, height: h }} />
      ) : (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <path d={signaturePath(sig, 0, 0, w, h)} fill="none" stroke="#111" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

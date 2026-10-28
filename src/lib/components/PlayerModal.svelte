<script lang="ts">
  import type { ChannelEntry } from "../types.ts";
  import { embedUrl } from "../embed.ts";

  interface Props {
    entry: ChannelEntry;
    onClose: () => void;
  }
  let { entry, onClose }: Props = $props();

  const src = $derived(embedUrl(entry));
  const vertical = $derived(entry.section === "shorts");
  let dialog = $state<HTMLDialogElement | null>(null);

  // <dialog> nativo: Esc, foco atrapado y fondo inerte sin código extra.
  $effect(() => {
    const d = dialog;
    if (d && !d.open) d.showModal();
  });

  function onBackdrop(e: MouseEvent) {
    // Con padding 0, un clic sobre el propio <dialog> es un clic en el fondo.
    if (e.target === e.currentTarget) dialog?.close();
  }
</script>

<dialog bind:this={dialog} class="player" onclose={onClose} onclick={onBackdrop} aria-label="Reproductor">
  <div class="top">
    <a class="open" href={entry.url} target="_blank" rel="noopener noreferrer">
      Abrir en YouTube
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    </a>
    <button type="button" class="close" aria-label="Cerrar" onclick={() => dialog?.close()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </div>
  <div class="frame" class:vertical>
    {#if src}
      <!-- referrerpolicy: YouTube exige el referrer del sitio que embebe (si no, error 153). -->
      <iframe
        {src}
        title="Reproductor de YouTube"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    {/if}
  </div>
  <p class="hint">¿No carga? Algunos videos no permiten reproducirse fuera de YouTube: usa «Abrir en YouTube».</p>
</dialog>

<style>
  /* El reproductor es siempre oscuro, sea cual sea el tema de la app. */
  .player {
    padding: 0;
    border: 0;
    border-radius: 16px;
    background: #0b0c0f;
    color: #eceef2;
    overflow: hidden;
    width: min(94vw, 1100px);
    max-width: 94vw;
    max-height: 94vh;
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.6);
  }
  .player::backdrop {
    background: rgb(5 6 8 / 0.72);
    backdrop-filter: blur(4px);
  }
  .player:has(.vertical) {
    width: fit-content;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 8px 8px 16px;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #a4abb8;
    font-size: 13px;
    text-decoration: none;
  }
  .open:hover {
    color: #eceef2;
  }
  .close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #a4abb8;
    cursor: pointer;
  }
  .close:hover {
    background: rgb(255 255 255 / 0.1);
    color: #fff;
  }
  .close:focus-visible,
  .open:focus-visible {
    outline: 2px solid #7aa7ff;
    outline-offset: 2px;
  }
  .frame {
    aspect-ratio: 16 / 9;
    width: 100%;
    background: #000;
  }
  .frame.vertical {
    aspect-ratio: 9 / 16;
    width: auto;
    height: min(74vh, 780px);
    max-width: 94vw;
  }
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .hint {
    margin: 0;
    padding: 8px 16px 10px;
    color: #6f7685;
    font-size: 12px;
    /* No dicta el ancho del modal (en shorts manda el video): se ajusta a él. */
    width: 0;
    min-width: 100%;
  }
  @media (max-width: 640px) {
    .player {
      border-radius: 12px;
    }
    .frame.vertical {
      height: min(72vh, 760px);
    }
  }
</style>

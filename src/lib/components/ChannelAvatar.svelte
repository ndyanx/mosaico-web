<script lang="ts">
  import { avatarHue, initials } from "../channelSearch.ts";

  interface Props {
    /** Id del canal: fija el color del respaldo. */
    id: string;
    title: string;
    /** Avatar https de YouTube; null o si falla al cargar = iniciales. */
    src: string | null;
    /** Lado en px CSS. */
    size?: number;
  }
  let { id, title, src, size = 36 }: Props = $props();

  // Si la imagen falla (bloqueada, caducada) se muestran las iniciales; al cambiar `src` se reintenta.
  let failed = $state(false);
  $effect(() => {
    void src;
    failed = false;
  });

  const hue = $derived(avatarHue(id));
  const text = $derived(initials(title) || "?");
</script>

<span class="av" style="--s:{size}px; --h:{hue}" aria-hidden="true">
  {#if src && !failed}
    <img {src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (failed = true)} />
  {:else}
    <span class="ini">{text}</span>
  {/if}
</span>

<style>
  .av {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    overflow: hidden;
    background: light-dark(hsl(var(--h) 60% 88%), hsl(var(--h) 32% 26%));
    color: light-dark(hsl(var(--h) 50% 26%), hsl(var(--h) 70% 84%));
    font-size: calc(var(--s) * 0.38);
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: var(--surface-2);
  }
</style>

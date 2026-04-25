<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import PricingPlanCard from "../components/marketing/PricingPlanCard.vue";
import { useAuthStore } from "../stores/auth";
import { usePlanPricingSettings } from "../composables/usePlanPricingSettings";
import happySellerPhone from "../assets/marketing/happy-seller-phone.webp";

const auth = useAuthStore();
const router = useRouter();
const homeRoot = ref<HTMLElement | null>(null);
let revealObserver: IntersectionObserver | null = null;

const pricingCarouselRef = ref<HTMLElement | null>(null);
const pricingCarouselIndex = ref(0);
const pricingCarouselAtStart = ref(true);
const pricingCarouselAtEnd = ref(false);

let pricingCarouselScrollRaf = 0;
let pricingCarouselResizeObs: ResizeObserver | null = null;
const { plans: pricingPlans } = usePlanPricingSettings();

function pricingCarouselPrefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function currentPricingSlideIndex(): number {
  const el = pricingCarouselRef.value;
  if (!el) return 0;
  const slides = [
    ...el.querySelectorAll("[data-pricing-slide]"),
  ] as HTMLElement[];
  if (slides.length === 0) return 0;
  const elRect = el.getBoundingClientRect();
  const cx = elRect.left + elRect.width / 2;
  let best = 0;
  let bestD = Infinity;
  slides.forEach((s, i) => {
    const r = s.getBoundingClientRect();
    const sx = r.left + r.width / 2;
    const d = Math.abs(sx - cx);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function syncPricingCarousel(): void {
  const el = pricingCarouselRef.value;
  if (!el) return;
  const eps = 4;
  pricingCarouselAtStart.value = el.scrollLeft <= eps;
  pricingCarouselAtEnd.value =
    el.scrollLeft + el.clientWidth >= el.scrollWidth - eps;
  pricingCarouselIndex.value = currentPricingSlideIndex();
}

function onPricingCarouselScroll(): void {
  if (pricingCarouselScrollRaf) {
    cancelAnimationFrame(pricingCarouselScrollRaf);
  }
  pricingCarouselScrollRaf = requestAnimationFrame(() => {
    pricingCarouselScrollRaf = 0;
    syncPricingCarousel();
  });
}

function gotoPricingSlide(i: number): void {
  const el = pricingCarouselRef.value;
  const slides = el?.querySelectorAll("[data-pricing-slide]");
  const slide = slides?.[i] as HTMLElement | undefined;
  if (!slide) return;
  slide.scrollIntoView({
    block: "nearest",
    inline: "center",
    behavior: pricingCarouselPrefersReducedMotion() ? "auto" : "smooth",
  });
}

function scrollPricingCarousel(delta: 1 | -1): void {
  const next = Math.min(
    pricingPlans.value.length - 1,
    Math.max(0, currentPricingSlideIndex() + delta),
  );
  gotoPricingSlide(next);
}

function onPricingCarouselKeydown(ev: KeyboardEvent): void {
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    scrollPricingCarousel(-1);
  } else if (ev.key === "ArrowRight") {
    ev.preventDefault();
    scrollPricingCarousel(1);
  } else if (ev.key === "Home") {
    ev.preventDefault();
    gotoPricingSlide(0);
  } else if (ev.key === "End") {
    ev.preventDefault();
    gotoPricingSlide(pricingPlans.value.length - 1);
  }
}

function bindPricingCarousel(): void {
  const el = pricingCarouselRef.value;
  if (!el) return;
  el.addEventListener("scroll", onPricingCarouselScroll, { passive: true });
  pricingCarouselResizeObs = new ResizeObserver(() => {
    syncPricingCarousel();
  });
  pricingCarouselResizeObs.observe(el);
  syncPricingCarousel();
}

function unbindPricingCarousel(): void {
  pricingCarouselRef.value?.removeEventListener(
    "scroll",
    onPricingCarouselScroll,
  );
  pricingCarouselResizeObs?.disconnect();
  pricingCarouselResizeObs = null;
  if (pricingCarouselScrollRaf) {
    cancelAnimationFrame(pricingCarouselScrollRaf);
    pricingCarouselScrollRaf = 0;
  }
}

const hubQrDataUrl = ref("");
const storefrontQrDataUrl = ref("");

onMounted(async () => {
  const root = homeRoot.value;

  const markIn = (el: Element) => {
    el.classList.add("is-in");
  };

  if (root) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.querySelectorAll(".ui-reveal").forEach(markIn);
    } else {
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              markIn(entry.target);
              revealObserver?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -7% 0px" },
      );

      root
        .querySelectorAll(".ui-reveal")
        .forEach((el) => revealObserver!.observe(el));
    }
  }

  try {
    const QRCode = (await import("qrcode")).default;
    const loginAbs = new URL(
      router.resolve({ name: "login" }).href,
      window.location.origin,
    ).href;
    const pricingAbs = new URL(
      router.resolve({ name: "home", hash: "#pricing" }).href,
      window.location.origin,
    ).href;
    const opts = {
      width: 176,
      margin: 1,
      color: { dark: "#18181b", light: "#ffffff" },
      errorCorrectionLevel: "M" as const,
    };
    hubQrDataUrl.value = await QRCode.toDataURL(loginAbs, opts);
    storefrontQrDataUrl.value = await QRCode.toDataURL(pricingAbs, opts);
  } catch {
    /* QR is optional; cards still work via buttons */
  }

  await nextTick();
  bindPricingCarousel();
});

onBeforeUnmount(() => {
  revealObserver?.disconnect();
  revealObserver = null;
  unbindPricingCarousel();
});

const featureItems = [
  {
    t: "Your branded shop",
    d: "Catalog, cart, and a clear path to call or SMS so buyers reach you quickly.",
    icon: "store" as const,
  },
  {
    t: "Orders you can fulfil",
    d: "You keep offline payment control; buyers still see order and delivery status.",
    icon: "truck" as const,
  },
  {
    t: "Plans for every stage",
    d: "Scale capacity, branding, and automation as your catalogue and team grow.",
    icon: "layers" as const,
  },
];

const trustChips = ["MoMo", "SMS", "GHS", "Delivery tracking"];

const heroDetails = [
  "Hosted storefront at your own path — share one link on Instagram, SMS, or any social channel.",
  "Orders land in your dashboard with buyer notes, phone numbers, and delivery addresses.",
  "Customers follow live delivery states; you confirm handover when cash or MoMo hits your account.",
  "Upgrade tiers when you need more themes, automation, or team seats — no replatforming.",
];

const howItWorks = [
  {
    step: "01",
    title: "Create your store",
    body: "Sign up, choose a slug, upload products, and set your store phone so buyers can reach you instantly.",
  },
  {
    step: "02",
    title: "Share your link",
    body: "Post your shop URL everywhere you already sell. Cart and checkout stay clear and lightweight.",
  },
  {
    step: "03",
    title: "Fulfil & get paid",
    body: "Mark orders, update delivery, and collect MoMo or cash on your terms — subscriptions cover the platform only.",
  },
];
</script>

<template>
  <div
    ref="homeRoot"
    class="bg-white text-zinc-900 antialiased [font-feature-settings:'ss01']"
  >
    <!-- Hero -->
    <div
      class="relative overflow-hidden border-b border-zinc-200/90 bg-gradient-to-b from-zinc-50 via-zinc-100/90 to-zinc-50"
    >
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-80"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute -right-40 top-20 h-96 w-96 rounded-full bg-emerald-200/20 blur-3xl ui-anim-float motion-reduce:animate-none"
        aria-hidden="true"
      />

      <div
        class="relative mx-auto max-w-[min(100%,120rem)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24 xl:px-12 xl:py-28 2xl:px-16"
      >
        <div
          class="group/hero grid items-center gap-14 lg:grid-cols-[minmax(0,1.22fr)_minmax(0,0.82fr)] lg:gap-20 xl:gap-24"
        >
          <div class="max-w-xl lg:max-w-2xl xl:max-w-3xl">
            <p
              class="ui-anim-fade-up ui-delay-0 text-[13px] font-semibold tracking-wide text-emerald-700"
            >
              U&amp;I Tech Solutions · Seller commerce
            </p>
            <h1
              class="ui-anim-blur-in ui-delay-1 mt-4 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-zinc-950 sm:text-5xl sm:leading-[1.06] lg:text-[3.125rem] xl:text-[3.375rem]"
            >
              Find the storefront your customers already trust.
            </h1>
            <p
              class="ui-anim-fade-up ui-delay-2 mt-6 max-w-xl text-pretty text-lg leading-relaxed text-zinc-600 sm:text-xl sm:leading-relaxed"
            >
              Cart, checkout clarity, and delivery updates — without forcing
              MoMo or card on every item. You stay in control of how you get
              paid.
            </p>
            <p
              class="ui-anim-fade-up ui-delay-3 mt-5 max-w-2xl text-pretty text-base leading-relaxed text-zinc-600 sm:text-lg sm:leading-relaxed"
            >
              Built for Ghanaian sellers who already close through direct chat: your
              shop stays the catalogue, while you keep your payout rhythm —
              MoMo, cash on delivery, or in-person pickup.
            </p>
            <ul
              class="ui-anim-fade-up ui-delay-4 mt-8 space-y-3 border-l-2 border-emerald-200/90 pl-5"
            >
              <li
                v-for="(line, idx) in heroDetails"
                :key="idx"
                class="text-sm leading-relaxed text-zinc-600 transition-[transform,color] duration-300 hover:translate-x-0.5 sm:text-[15px] sm:leading-relaxed"
              >
                {{ line }}
              </li>
            </ul>

            <div
              class="ui-anim-fade-up ui-delay-5 mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
            >
              <RouterLink
                v-if="auth.isSignedIn && !auth.isSuperAdmin"
                to="/dashboard"
                class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-xl active:scale-[0.98] motion-reduce:hover:translate-y-0"
              >
                Go to dashboard
                <svg
                  class="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </RouterLink>
              <RouterLink
                v-else-if="auth.isSignedIn && auth.isSuperAdmin"
                to="/admin"
                class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-xl active:scale-[0.98] motion-reduce:hover:translate-y-0"
              >
                Platform admin
                <svg
                  class="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </RouterLink>
              <RouterLink
                v-else
                :to="{ name: 'login', query: { mode: 'sign-up' } }"
                class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-xl active:scale-[0.98] motion-reduce:hover:translate-y-0"
              >
                Get started
                <svg
                  class="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </RouterLink>
              <RouterLink
                :to="{ name: 'home', hash: '#pricing' }"
                class="inline-flex min-h-[48px] items-center justify-center rounded-full border border-zinc-300/80 bg-white/60 px-8 py-3 text-sm font-semibold text-zinc-800 backdrop-blur-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-400 hover:bg-white hover:shadow-md active:scale-[0.98] motion-reduce:hover:translate-y-0"
              >
                View pricing
              </RouterLink>
            </div>

            <div class="ui-anim-fade-up ui-delay-6 mt-12">
              <p
                class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
              >
                Works great with
              </p>
              <ul class="mt-3 flex flex-wrap gap-2">
                <li
                  v-for="chip in trustChips"
                  :key="chip"
                  class="rounded-full border border-zinc-200/90 bg-white/90 px-3.5 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-emerald-200/70 hover:shadow-md motion-reduce:hover:translate-y-0"
                >
                  {{ chip }}
                </li>
              </ul>
            </div>
          </div>

          <!-- Phone (decorative mockup — modern slab + Dynamic Island) -->
          <div
            class="ui-anim-fade-up ui-delay-5 relative mx-auto flex w-full max-w-[min(100%,340px)] justify-center motion-reduce:transition-none lg:mx-0 lg:max-w-[min(100%,400px)] lg:justify-end [perspective:1400px] motion-reduce:transform-none motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100 lg:transition-transform lg:duration-700 lg:ease-[cubic-bezier(0.22,1,0.36,1)] lg:will-change-transform lg:group-hover/hero:-translate-y-2 lg:group-hover/hero:scale-[1.02]"
            aria-hidden="true"
          >
            <div
              class="relative w-full motion-reduce:transform-none [transform:rotateY(-3deg)] motion-reduce:[transform:none] lg:transition-transform lg:duration-700 lg:group-hover/hero:[transform:rotateY(-1deg)]"
            >
              <div
                class="absolute -left-[2px] top-[18%] z-0 hidden h-9 w-[2.5px] rounded-l-[2px] bg-gradient-to-b from-zinc-400 via-zinc-600 to-zinc-800 sm:block"
              />
              <div
                class="absolute -left-[2px] top-[28%] z-0 hidden h-14 w-[2.5px] rounded-l-[2px] bg-gradient-to-b from-zinc-400 via-zinc-600 to-zinc-800 sm:block"
              />
              <div
                class="absolute -right-[2px] top-[22%] z-0 hidden h-20 w-[2.5px] rounded-r-[2px] bg-gradient-to-b from-zinc-400 via-zinc-600 to-zinc-800 sm:block"
              />

              <div
                class="relative w-full rounded-[2.85rem] bg-gradient-to-b from-zinc-200 via-zinc-400 to-zinc-800 p-[3px] shadow-[0_50px_100px_-36px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.35)]"
              >
                <div
                  class="rounded-[2.72rem] bg-gradient-to-b from-zinc-900 to-black p-[2px]"
                >
                  <div
                    class="relative aspect-[9/19.5] w-full overflow-hidden rounded-[2.58rem] bg-black"
                  >
                    <div
                      class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(99,102,241,0.22),transparent_55%),radial-gradient(90%_60%_at_100%_0%,rgba(16,185,129,0.14),transparent_45%),radial-gradient(80%_50%_at_0%_100%,rgba(250,204,21,0.1),transparent_50%)]"
                    />

                    <div
                      class="absolute left-1/2 top-2.5 z-20 flex h-[31px] w-[112px] -translate-x-1/2 items-center rounded-full bg-black shadow-[0_4px_24px_rgba(0,0,0,0.55),inset_0_-1px_0_rgba(255,255,255,0.06)]"
                    >
                      <div
                        class="flex w-full items-center justify-between px-3.5"
                      >
                        <div class="flex gap-1">
                          <span class="h-1 w-1 rounded-full bg-zinc-700" />
                          <span class="h-1 w-1 rounded-full bg-zinc-800" />
                        </div>
                        <div
                          class="h-2.5 w-2.5 rounded-full bg-zinc-800 ring-[1.5px] ring-zinc-600/70"
                        />
                      </div>
                    </div>

                    <div
                      class="relative z-10 flex h-full flex-col bg-gradient-to-b from-zinc-100 via-white to-zinc-50"
                    >
                      <div
                        class="flex shrink-0 items-end justify-between px-5 pb-1 pt-[42px] text-[13px] font-semibold tracking-tight text-zinc-900"
                      >
                        <span>9:41</span>
                        <div class="flex items-center gap-1.5 pb-0.5">
                          <svg
                            class="h-2.5 w-4 text-zinc-900"
                            viewBox="0 0 16 10"
                            fill="currentColor"
                          >
                            <rect x="0" y="6" width="2" height="4" rx="0.5" />
                            <rect x="4" y="4" width="2" height="6" rx="0.5" />
                            <rect x="8" y="2" width="2" height="8" rx="0.5" />
                            <rect x="12" y="0" width="2" height="10" rx="0.5" />
                          </svg>
                          <svg
                            class="h-3 w-4 text-zinc-900"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path
                              d="M12 18c.8 0 1.5-.7 1.5-1.5S12.8 15 12 15s-1.5.7-1.5 1.5.7 1.5 1.5 1.5zm-4.2-4.2 1.4 1.4c1.3-1.3 3.3-1.3 4.6 0l1.4-1.4c-2-2-5.4-2-7.4 0zM5 8.8l1.4 1.4c3.1-3.1 8.1-3.1 11.2 0L19 8.8c-3.9-3.9-10.1-3.9-14 0zm-2.8-2.8 1.4 1.4c5.2-5.2 13.6-5.2 18.8 0l1.4-1.4c-6.1-6.1-15.9-6.1-22 0z"
                            />
                          </svg>
                          <div class="flex items-center gap-0.5">
                            <div
                              class="relative h-2.5 w-[22px] rounded-[3px] border-[1.5px] border-zinc-800/80 p-[1px]"
                            >
                              <div
                                class="h-full w-[62%] rounded-[2px] bg-lime-400"
                              />
                            </div>
                            <span
                              class="h-1 w-[2px] rounded-r-[1px] bg-zinc-800/80"
                            />
                          </div>
                        </div>
                      </div>

                      <div
                        class="flex flex-1 flex-col gap-2.5 overflow-hidden px-3 pb-24 pt-1"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <p
                              class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
                            >
                              Discover
                            </p>
                            <p
                              class="mt-0.5 text-xl font-bold tracking-tight text-zinc-950"
                            >
                              Nearby picks
                            </p>
                          </div>
                          <span
                            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 shadow-sm ring-1 ring-zinc-200/90"
                          >
                            <svg
                              class="h-4 w-4 text-zinc-600"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M15.75 6a3.75 3.75 0 11-7.5 0 7.5 7.5 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                              />
                            </svg>
                          </span>
                        </div>

                        <div
                          class="flex items-center gap-2 rounded-2xl border border-zinc-200/90 bg-white/90 px-3 py-2 text-xs text-zinc-500 shadow-sm backdrop-blur-sm"
                        >
                          <svg
                            class="h-3.5 w-3.5 shrink-0 text-zinc-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                            />
                          </svg>
                          <span class="font-medium text-zinc-700"
                            >Accra · Osu</span
                          >
                        </div>

                        <div class="-mx-1 flex gap-1.5 overflow-x-auto pb-0.5">
                          <span
                            class="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white"
                            >All</span
                          >
                          <span
                            class="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200/90"
                            >New</span
                          >
                          <span
                            class="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200/90"
                            >Near me</span
                          >
                          <span
                            class="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200/90"
                            >MoMo OK</span
                          >
                        </div>

                        <div
                          class="relative mt-0.5 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-md shadow-zinc-900/5 ring-1 ring-black/5"
                        >
                          <div
                            class="relative aspect-[5/3] bg-gradient-to-br from-emerald-100 via-teal-50 to-zinc-100"
                          >
                            <div
                              class="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-800 shadow-sm"
                            >
                              Featured
                            </div>
                            <span
                              class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/5 backdrop-blur-sm"
                            >
                              <svg
                                class="h-4 w-4 text-zinc-800"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                                />
                              </svg>
                            </span>
                            <div
                              class="absolute bottom-3 right-3 flex gap-0.5 rounded-full bg-black/35 px-2 py-1 backdrop-blur-md"
                            >
                              <span class="h-1 w-1 rounded-full bg-white" />
                              <span class="h-1 w-1 rounded-full bg-white/50" />
                              <span class="h-1 w-1 rounded-full bg-white/50" />
                            </div>
                          </div>
                          <div class="space-y-2 p-3.5">
                            <div class="flex items-start justify-between gap-2">
                              <div>
                                <p
                                  class="text-[15px] font-semibold leading-snug text-zinc-900"
                                >
                                  Handwoven kente runner
                                </p>
                                <p
                                  class="mt-1 flex items-center gap-1 text-xs text-zinc-500"
                                >
                                  <svg
                                    class="h-3 w-3 text-emerald-600"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    stroke-width="2"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                                    />
                                  </svg>
                                  Cantonments · 12 min
                                </p>
                              </div>
                              <p
                                class="shrink-0 text-sm font-bold tabular-nums text-zinc-900"
                              >
                                GHS 120
                              </p>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                              <span
                                class="inline-flex rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-600"
                                >Pickup Sat</span
                              >
                              <span
                                class="inline-flex rounded-md bg-lime-200/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-900"
                                >MoMo on delivery</span
                              >
                              <div
                                class="ml-auto flex items-center gap-0.5 text-amber-500"
                              >
                                <svg
                                  class="h-3.5 w-3.5"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                                  />
                                </svg>
                                <span
                                  class="text-[11px] font-semibold text-zinc-700"
                                  >4.9</span
                                >
                              </div>
                            </div>
                          </div>
                        </div>

                        <div
                          class="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-2.5 text-xs shadow-sm backdrop-blur-sm"
                        >
                          <div class="flex items-center gap-2">
                            <span
                              class="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900 text-[11px] font-bold text-white"
                              >2</span
                            >
                            <div>
                              <p class="font-semibold text-zinc-900">Cart</p>
                              <p class="text-[10px] text-zinc-500">
                                Est. GHS 240 · tap to review
                              </p>
                            </div>
                          </div>
                          <svg
                            class="h-4 w-4 text-zinc-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M8.25 4.5l7.5 7.5-7.5 7.5"
                            />
                          </svg>
                        </div>

                        <div
                          class="rounded-2xl bg-lime-400 py-3 text-center text-sm font-bold text-zinc-900 shadow-lg shadow-lime-900/10"
                        >
                          Message seller
                        </div>
                      </div>

                      <div
                        class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white to-transparent pb-1 pt-10"
                      >
                        <div
                          class="mx-2 flex items-center justify-around rounded-[2rem] border border-zinc-200/70 bg-white/85 px-1 py-2 shadow-lg shadow-zinc-900/10 backdrop-blur-xl"
                        >
                          <span
                            class="flex flex-1 flex-col items-center gap-0.5 py-1 text-[9px] font-semibold text-zinc-900"
                          >
                            <svg
                              class="h-5 w-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="1.75"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="m2.25 12 8.954-8.955.022-.022a.75.75 0 011.06 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h5.25c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                              />
                            </svg>
                            Home
                          </span>
                          <span
                            class="flex flex-1 flex-col items-center gap-0.5 py-1 text-[9px] font-medium text-zinc-400"
                          >
                            <svg
                              class="h-5 w-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="1.75"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                              />
                            </svg>
                            Search
                          </span>
                          <span
                            class="relative flex flex-1 flex-col items-center gap-0.5 py-1 text-[9px] font-medium text-zinc-400"
                          >
                            <span
                              class="absolute -top-0.5 right-[26%] flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-lime-400 px-1 text-[8px] font-bold text-zinc-900"
                              >2</span
                            >
                            <svg
                              class="h-5 w-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="1.75"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15a3 3 0 00-3-3M16.5 7.5a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            Bag
                          </span>
                          <span
                            class="flex flex-1 flex-col items-center gap-0.5 py-1 text-[9px] font-medium text-zinc-400"
                          >
                            <svg
                              class="h-5 w-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="1.75"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M15.75 6a3.75 3.75 0 11-7.5 0 7.5 7.5 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                              />
                            </svg>
                            You
                          </span>
                        </div>
                        <div
                          class="mx-auto mt-2 h-1 w-28 rounded-full bg-zinc-900/25"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats + cards: full-bleed seller photo, content overlaid -->
    <div
      class="relative isolate min-h-[min(88vh,52rem)] overflow-hidden border-b border-zinc-900/20 sm:min-h-[min(90vh,56rem)] lg:min-h-[min(92vh,58rem)]"
    >
      <img
        :src="happySellerPhone"
        width="1920"
        height="1080"
        class="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
        alt="Happy seller checking new orders on her phone at her shop."
        loading="lazy"
        decoding="async"
      />
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-950/93 via-zinc-950/55 to-zinc-950/35"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-r from-zinc-950/85 via-zinc-950/40 to-transparent sm:from-zinc-950/80"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-zinc-950/75 to-transparent"
        aria-hidden="true"
      />

      <div
        class="relative z-10 mx-auto flex min-h-[min(88vh,52rem)] max-w-[min(100%,120rem)] flex-col justify-between gap-12 px-4 py-16 sm:min-h-[min(90vh,56rem)] sm:gap-14 sm:px-6 sm:py-20 lg:min-h-[min(92vh,58rem)] lg:flex-row lg:items-end lg:justify-between lg:gap-12 lg:px-8 lg:py-24 xl:gap-16 xl:px-12 2xl:px-16"
      >
        <div class="ui-reveal max-w-2xl lg:max-w-[min(100%,36rem)] xl:max-w-2xl">
          <p
            class="text-xs font-semibold uppercase tracking-wider text-lime-300/90"
          >
            Orders on the go
          </p>
          <h2
            class="mt-2 text-balance text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl lg:text-[2.375rem] lg:leading-tight"
          >
            Every seller tool for your city — in one platform.
          </h2>
          <p class="mt-5 text-lg leading-relaxed text-zinc-200">
            Run catalogue, orders, and delivery updates from the browsers your
            team already uses.
          </p>
          <p class="mt-4 text-base leading-relaxed text-zinc-300/95">
            Super admins keep the network healthy; store owners get isolated
            dashboards per shop. Shoppers never see your back-office — only a
            fast storefront, clear totals in GHS, and delivery states they can
            follow without DMing you for every update.
          </p>

          <div class="mt-10 grid max-w-md grid-cols-3 gap-3 sm:mt-12 sm:gap-4">
            <div
              class="ui-reveal rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-center shadow-lg shadow-black/10 backdrop-blur-md transition-shadow duration-300 hover:border-white/30 hover:bg-white/15 sm:px-5 sm:py-5"
              style="transition-delay: 80ms"
            >
              <p
                class="text-[11px] font-medium uppercase tracking-wider text-zinc-300"
              >
                Plans
              </p>
              <p
                class="mt-1.5 text-2xl font-semibold tabular-nums text-white sm:text-3xl"
              >
                3
              </p>
            </div>
            <div
              class="ui-reveal rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-center shadow-lg shadow-black/10 backdrop-blur-md transition-shadow duration-300 hover:border-white/30 hover:bg-white/15 sm:px-5 sm:py-5"
              style="transition-delay: 160ms"
            >
              <p
                class="text-[11px] font-medium uppercase tracking-wider text-zinc-300"
              >
                Currency
              </p>
              <p
                class="mt-1.5 text-2xl font-semibold text-white sm:text-3xl"
              >
                GHS
              </p>
            </div>
            <div
              class="ui-reveal rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-center shadow-lg shadow-black/10 backdrop-blur-md transition-shadow duration-300 hover:border-white/30 hover:bg-white/15 sm:px-5 sm:py-5"
              style="transition-delay: 240ms"
            >
              <p
                class="text-[11px] font-medium uppercase tracking-wider text-zinc-300"
              >
                Payouts
              </p>
              <p
                class="mt-1.5 text-2xl font-semibold text-white sm:text-3xl"
              >
                You
              </p>
            </div>
          </div>
        </div>

        <div
          class="grid w-full max-w-2xl shrink-0 gap-4 sm:grid-cols-2 lg:max-w-lg xl:max-w-xl"
        >
          <div
            class="ui-reveal group relative flex flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-7 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-500 ease-out hover:-translate-y-1 hover:border-zinc-300 hover:bg-white hover:shadow-[0_28px_60px_-24px_rgba(0,0,0,0.4)] motion-reduce:hover:translate-y-0 sm:p-8"
          >
            <div
              class="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-zinc-100 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              aria-hidden="true"
            />
            <p
              class="relative text-xs font-semibold uppercase tracking-wider text-zinc-500"
            >
              Seller hub
            </p>
            <p class="relative mt-1 text-sm text-zinc-400">
              Any modern browser
            </p>
            <RouterLink
              to="/login"
              class="relative mt-8 inline-flex w-fit items-center rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              Open dashboard
            </RouterLink>
            <div
              class="relative mt-8 flex min-h-[8.5rem] items-center justify-center rounded-2xl border border-zinc-200 bg-white p-3 sm:min-h-[9rem]"
            >
              <img
                v-if="hubQrDataUrl"
                :src="hubQrDataUrl"
                width="128"
                height="128"
                class="h-28 w-28 rounded-md sm:h-32 sm:w-32"
                alt="QR code that opens the seller log-in page in your browser."
              />
              <div
                v-else
                class="h-28 w-28 animate-pulse rounded-md bg-zinc-100 sm:h-32 sm:w-32"
                aria-hidden="true"
              />
            </div>
            <p
              class="relative mt-2 text-center text-[10px] font-medium text-zinc-400"
            >
              Scan to log in
            </p>
            <div class="relative mt-5 flex justify-center text-zinc-200">
              <svg
                class="h-12 w-12 opacity-50"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
                />
              </svg>
            </div>
          </div>

          <div
            class="ui-reveal group relative flex flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-7 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-500 ease-out hover:-translate-y-1 hover:border-zinc-300 hover:bg-white hover:shadow-[0_28px_60px_-24px_rgba(0,0,0,0.4)] motion-reduce:hover:translate-y-0 sm:p-8"
          >
            <div
              class="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-emerald-50 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              aria-hidden="true"
            />
            <p
              class="relative text-xs font-semibold uppercase tracking-wider text-zinc-500"
            >
              Your storefront
            </p>
            <p class="relative mt-1 text-sm text-zinc-400">Share one link</p>
            <RouterLink
              :to="{ name: 'home', hash: '#pricing' }"
              class="relative mt-8 inline-flex w-fit items-center rounded-full border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              Compare plans
            </RouterLink>
            <div
              class="relative mt-8 flex min-h-[8.5rem] items-center justify-center rounded-2xl border border-zinc-200 bg-white p-3 sm:min-h-[9rem]"
            >
              <img
                v-if="storefrontQrDataUrl"
                :src="storefrontQrDataUrl"
                width="128"
                height="128"
                class="h-28 w-28 rounded-md sm:h-32 sm:w-32"
                alt="QR code that opens this site’s pricing section."
              />
              <div
                v-else
                class="h-28 w-28 animate-pulse rounded-md bg-zinc-100 sm:h-32 sm:w-32"
                aria-hidden="true"
              />
            </div>
            <p
              class="relative mt-2 text-center text-[10px] font-medium text-zinc-400"
            >
              Scan for plans
            </p>
            <div class="relative mt-5 flex justify-center text-zinc-200">
              <svg
                class="h-12 w-12 opacity-50"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993 0 .5511-.4483.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.5758 12 7.5758s-3.5902.6681-4.7379 1.6744L5.2398 5.7468a.4161.4161 0 00-.5676-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.186.8535 13.3064.8535 15.8465c0 3.6654 2.9869 6.6523 6.6523 6.6523h10.9884c3.6654 0 6.6523-2.9869 6.6523-6.6523 0-2.5401-1.8354-4.6596-4.2405-5.5251"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- How it works -->
    <section
      id="how-it-works"
      class="scroll-mt-28 border-b border-zinc-100 bg-zinc-50/40 sm:scroll-mt-32"
      aria-labelledby="how-heading"
    >
      <div
        class="mx-auto max-w-[min(100%,120rem)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24 xl:px-12 2xl:px-16"
      >
        <div
          class="ui-reveal mx-auto max-w-3xl text-center lg:max-w-none lg:text-left"
        >
          <p
            class="text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            How it works
          </p>
          <h2
            id="how-heading"
            class="mt-3 text-balance text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl"
          >
            From first product to fulfilled order — without changing how you
            collect money.
          </h2>
          <p
            class="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-zinc-600 lg:mx-0"
          >
            Subscriptions unlock seller software and hosting. Checkout captures
            intent and contact details; you confirm payment offline the same way
            you already trust with your buyers.
          </p>
        </div>
        <ol class="mt-14 grid gap-6 lg:mt-16 lg:grid-cols-3 lg:gap-8">
          <li
            v-for="(row, idx) in howItWorks"
            :key="row.step"
            class="ui-reveal relative rounded-3xl border border-zinc-200/90 bg-white p-7 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:border-emerald-200/80 hover:shadow-md motion-reduce:hover:translate-y-0 sm:p-8"
          >
            <span
              class="absolute right-6 top-6 text-4xl font-bold tabular-nums text-zinc-100 sm:text-5xl"
              aria-hidden="true"
              >{{ row.step }}</span
            >
            <p
              class="text-xs font-semibold uppercase tracking-wider text-emerald-700"
            >
              Step {{ idx + 1 }}
            </p>
            <h3 class="relative mt-3 text-lg font-semibold text-zinc-950">
              {{ row.title }}
            </h3>
            <p class="relative mt-2 text-sm leading-relaxed text-zinc-600">
              {{ row.body }}
            </p>
          </li>
        </ol>
      </div>
    </section>

    <!-- Features -->
    <section
      id="features"
      class="scroll-mt-28 border-b border-zinc-100 bg-zinc-50/70 sm:scroll-mt-32"
      aria-labelledby="features-heading"
    >
      <div
        class="mx-auto max-w-[min(100%,120rem)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 xl:px-12 2xl:px-16"
      >
        <div class="ui-reveal mx-auto max-w-2xl text-center">
          <p
            class="text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            Why sellers choose us
          </p>
          <h2
            id="features-heading"
            class="mt-3 text-balance text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl"
          >
            Everything shoppers see — and everything you control behind the
            scenes.
          </h2>
        </div>
        <ul
          class="mx-auto mt-14 grid gap-5 sm:grid-cols-2 md:grid-cols-3 md:gap-6"
        >
          <li
            v-for="(item, i) in featureItems"
            :key="item.t"
            class="ui-reveal group relative rounded-3xl border border-zinc-200/90 bg-white p-7 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:border-emerald-200/80 hover:shadow-lg motion-reduce:hover:translate-y-0"
          >
            <div
              class="absolute left-0 top-8 h-12 w-1 rounded-r-full bg-emerald-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden="true"
            />
            <div
              class="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80 transition-all duration-300 ease-out group-hover:scale-105 group-hover:bg-emerald-50 group-hover:text-emerald-800 group-hover:ring-emerald-200/60 motion-reduce:group-hover:scale-100"
            >
              <svg
                v-if="item.icon === 'store'"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18M2.25 9h1.5m2.25 0h1.5m2.25 0h1.5m2.25 0H15m3 0h1.5M5.25 19.5h13.5a.75.75 0 00.75-.75V6.75a.75.75 0 00-.75-.75H5.25a.75.75 0 00-.75.75v12a.75.75 0 00.75.75z"
                />
              </svg>
              <svg
                v-else-if="item.icon === 'truck'"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.25 2.25 0 00-1.227-1.004l-3.75-1.688m0 0h-9.375m9.375 0c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125zm9.75-12c0-.621-.504-1.125-1.125-1.125H15.75c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h1.125c.621 0 1.125-.504 1.125-1.125V9.75z"
                />
              </svg>
              <svg
                v-else
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                />
              </svg>
            </div>
            <p class="mt-5 text-[11px] font-medium tabular-nums text-zinc-400">
              {{ String(i + 1).padStart(2, "0") }}
            </p>
            <h3 class="mt-1 text-lg font-semibold text-zinc-950">
              {{ item.t }}
            </h3>
            <p class="mt-2 text-sm leading-relaxed text-zinc-600">
              {{ item.d }}
            </p>
          </li>
        </ul>
      </div>
    </section>

    <!-- Pricing -->
    <section
      id="pricing"
      class="relative isolate overflow-hidden scroll-mt-28 bg-gradient-to-b from-zinc-50 via-white to-zinc-100 py-20 sm:scroll-mt-32 sm:py-24 lg:py-28"
      aria-labelledby="pricing-heading"
    >
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          class="absolute -top-48 left-1/2 h-[min(42rem,120%)] w-[min(90rem,200%)] -translate-x-1/2 rounded-full bg-lime-400/[0.18] blur-3xl"
        />
        <div
          class="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-emerald-400/[0.14] blur-3xl sm:h-96 sm:w-96"
        />
        <div
          class="absolute left-0 top-1/4 h-72 w-72 -translate-x-1/3 rounded-full bg-violet-400/[0.08] blur-3xl"
        />
        <div
          class="absolute inset-0 bg-[linear-gradient(rgba(24,24,27,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(24,24,27,0.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_75%_55%_at_50%_35%,#000_20%,transparent_70%)]"
        />
        <div
          class="absolute inset-0 bg-gradient-to-b from-white via-transparent to-zinc-200/40"
        />
      </div>
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-zinc-300/80 to-transparent"
        aria-hidden="true"
      />
      <div
        class="relative z-[2] mx-auto max-w-[min(100%,120rem)] px-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16"
      >
        <div class="ui-reveal mx-auto max-w-2xl text-center">
          <p
            class="text-xs font-semibold uppercase tracking-wider text-lime-700"
          >
            Plans &amp; pricing
          </p>
          <h2
            id="pricing-heading"
            class="mt-4 text-balance text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl md:text-5xl"
          >
            Pick the plan that matches your ambition
          </h2>
          <p class="mt-5 text-pretty text-lg leading-relaxed text-zinc-600">
            Subscriptions cover your seller tools and storefront. Your customers
            still pay you directly for products — cash or MoMo on delivery, your
            rules. Use the track, dots, or arrow keys — about three tiers fit on
            large screens; the rest snap into place.
          </p>
        </div>

        <div
          class="relative mt-14 rounded-2xl outline-none ring-offset-2 ring-offset-white focus-visible:ring-2 focus-visible:ring-lime-500/70 lg:mt-16"
          role="region"
          aria-roledescription="carousel"
          aria-label="Pricing plans"
          tabindex="0"
          @keydown="onPricingCarouselKeydown"
        >
          <div
            class="mb-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-zinc-200/90 bg-white/95 px-4 py-4 shadow-md shadow-zinc-900/5 sm:flex-row sm:gap-10 sm:px-6 sm:py-4"
          >
            <div
              class="flex flex-wrap items-center justify-center gap-3"
              role="radiogroup"
              aria-label="Choose a pricing plan"
            >
              <button
                v-for="(plan, i) in pricingPlans"
                :key="plan.id"
                type="button"
                role="radio"
                class="flex items-center justify-center rounded-full transition-all duration-300 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600/90"
                :class="
                  i === pricingCarouselIndex
                    ? 'h-11 min-w-[4.75rem] bg-lime-500 px-3 shadow-[0_0_22px_rgba(132,204,22,0.55)] ring-2 ring-lime-400/70 ring-offset-2 ring-offset-white'
                    : 'h-11 w-11 hover:bg-zinc-100/90'
                "
                :aria-checked="i === pricingCarouselIndex"
                :aria-label="`Show ${plan.name} plan`"
                @click="gotoPricingSlide(i)"
              >
                <span
                  class="block rounded-full transition-all duration-300"
                  :class="
                    i === pricingCarouselIndex
                      ? 'h-3.5 w-10 bg-white/95'
                      : 'h-3.5 w-3.5 bg-zinc-500 shadow-inner shadow-black/15'
                  "
                  aria-hidden="true"
                />
              </button>
            </div>
            <p
              class="text-center text-sm font-semibold tabular-nums tracking-tight text-zinc-600 sm:text-base"
            >
              <span class="text-zinc-900">{{
                pricingPlans[pricingCarouselIndex]?.name ?? ""
              }}</span>
              <span class="mx-2 text-zinc-400 font-normal" aria-hidden="true"
                >·</span
              >
              <span class="font-bold text-zinc-800"
                >{{ pricingCarouselIndex + 1 }} /
                {{ pricingPlans.length }}</span
              >
            </p>
          </div>

          <div
            ref="pricingCarouselRef"
            class="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth scroll-px-4 pb-4 pt-1 [-ms-overflow-style:none] [scrollbar-color:rgba(24,24,27,0.22)_transparent] [scrollbar-width:thin] sm:scroll-px-6 sm:gap-6 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300/90 [&::-webkit-scrollbar-track]:bg-transparent"
          >
            <div
              v-for="(plan, slideIndex) in pricingPlans"
              :id="`pricing-slide-${plan.id}`"
              :key="plan.id"
              data-pricing-slide
              class="ui-reveal shrink-0 snap-center overflow-visible [flex:0_0_min(20rem,calc(100vw-2.75rem))] sm:[flex:0_0_calc(50%-0.75rem)] lg:[flex:0_0_calc((100%-3rem)/3)]"
              role="group"
              :aria-roledescription="`Slide ${slideIndex + 1} of ${pricingPlans.length}`"
              :aria-label="`${plan.name} plan`"
            >
              <PricingPlanCard
                :plan="plan"
                :tone="plan.highlighted ? 'hero' : 'side'"
              />
            </div>
          </div>

          <div
            class="pointer-events-none absolute inset-y-6 left-0 right-0 z-[3] flex items-center justify-between sm:inset-y-10"
          >
            <button
              type="button"
              class="pointer-events-auto ml-0 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200/90 bg-white/95 text-zinc-800 shadow-md shadow-zinc-900/10 backdrop-blur-sm transition enabled:hover:border-zinc-300 enabled:hover:bg-zinc-50 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 sm:ml-1"
              :disabled="pricingCarouselAtStart"
              aria-label="Previous pricing plan"
              @click="scrollPricingCarousel(-1)"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <button
              type="button"
              class="pointer-events-auto mr-0 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200/90 bg-white/95 text-zinc-800 shadow-md shadow-zinc-900/10 backdrop-blur-sm transition enabled:hover:border-zinc-300 enabled:hover:bg-zinc-50 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 sm:mr-1"
              :disabled="pricingCarouselAtEnd"
              aria-label="Next pricing plan"
              @click="scrollPricingCarousel(1)"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m8.25 4.5 7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>
        </div>
        <p
          class="ui-reveal mx-auto mt-12 max-w-2xl text-center text-sm leading-relaxed text-zinc-600"
        >
          Card or MoMo fees from your payment provider may apply at checkout.
          Features can vary by rollout — confirm with sales before you
          subscribe.
        </p>
      </div>
    </section>
  </div>
</template>

import type { AppConfig } from "@/src/contracts/config";

const PREMIUM_ATTR = "data-bluenoise-hide-premium";
const PREMIUM_FEATURE_PROMPT_ATTR =
	"data-bluenoise-hide-premium-feature-prompt";
const FOOTER_ATTR = "data-bluenoise-hide-footer";
const TRENDS_ATTR = "data-bluenoise-hide-trends";
const FOLLOW_ATTR = "data-bluenoise-hide-follow";
const TITLE_COUNT_ATTR = "data-bluenoise-hide-title-count";
const BADGES_ATTR = "data-bluenoise-hide-notification-badges";
const NEW_POSTS_ATTR = "data-bluenoise-hide-new-posts";
const GROK_ATTR = "data-bluenoise-hide-grok";
const MESSAGE_ATTR = "data-bluenoise-hide-message";
const CUSTOM_HIDDEN_ATTR = "data-bluenoise-custom-hidden";
const SIDEBAR_ATTR = "data-bluenoise-collapse-sidebar";
const COMPOSE_ICON_MARK = "data-bluenoise-compose-icon";
const LIVE_STREAMS_HEADING_RE = /^(?:X \u4e0a\u7684\u76f4\u64ad|live on x)$/i;
const MOBILE_LIVE_BUTTON_RE =
	/^(?:Broadcast|Space|\u76f4\u64ad|\u5e7f\u64ad|\u7a7a\u95f4)(?:\s*[,\uff0c:]|\b)/i;
const LOGO_SEL = 'a[aria-label="X"] svg';
const BIRD_MARK = "data-bluenoise-bird";
const TITLE_COUNT_RE = /^\(\d+\+?\)\s*/;
const CLEAN_FAVICON = "https://x.com/favicon.ico";

interface ComposeIconState {
	originalChildren: DocumentFragment;
}

export interface PageMakeoverController {
	apply(config: AppConfig): void;
	reset(): void;
}

export function findNewPostsPromptButton(label: Element): Element | null {
	const pill = label.parentElement;
	if (!pill?.querySelector('[data-testid="userAvatars"]')) return null;
	return label.closest("button");
}

export function isMobileLiveDockRail(rail: Element): boolean {
	return [...rail.querySelectorAll("button[aria-label]")].some((button) =>
		MOBILE_LIVE_BUTTON_RE.test(button.getAttribute("aria-label") ?? ""),
	);
}

export function createPageMakeoverController(options: {
	birdSvg: string;
	isStatusPage(): boolean;
}): PageMakeoverController {
	let cfg: AppConfig | null = null;
	let birdData: { viewBox: string; fill: string; path: string } | undefined;
	let titleBeforeCount = "";
	const originalFavicons = new Map<HTMLLinkElement, string>();
	const composeOriginalChildren = new Map<HTMLElement, ComposeIconState>();
	const sidebarOriginalStyles = new Map<HTMLElement, string>();
	const sidebarOriginalClasses = new Map<HTMLElement, string>();

	function getBirdData(): { viewBox: string; fill: string; path: string } {
		if (birdData) return birdData;
		const doc = new DOMParser().parseFromString(
			options.birdSvg,
			"image/svg+xml",
		);
		const source = doc.querySelector("svg");
		const path = source?.querySelector("path");
		if (!source || !path) throw new Error("Invalid Twitter logo SVG");
		const next = {
			viewBox: source.getAttribute("viewBox") ?? "0 0 248 204",
			fill: path.getAttribute("fill") ?? "#1d9bf0",
			path: path.getAttribute("d") ?? "",
		};
		birdData = next;
		return next;
	}

	function applyPageCustomizations(): void {
		if (!cfg) return;
		const enabled = cfg.pageCleanupEnabled;
		for (const el of document.querySelectorAll(`[${CUSTOM_HIDDEN_ATTR}]`))
			el.removeAttribute(CUSTOM_HIDDEN_ATTR);
		// Title/favicon state must also be restored when the master switch is off.
		applyTitleAndFavicon();
		if (!enabled) return;

		const hideAncestors = (element: Element, levels: number): void => {
			let current: Element | null = element;
			for (let i = 0; i <= levels && current; i++) {
				if (current instanceof HTMLElement)
					current.setAttribute(CUSTOM_HIDDEN_ATTR, "");
				current = current.parentElement;
			}
		};
		if (cfg.hideFollowSuggestions) {
			for (const aside of document.querySelectorAll<HTMLElement>(
				'aside[role="complementary"]:has(> div > h2[role="heading"]):has(> ul[role="list"] > li[data-testid="UserCell"])',
			))
				hideAncestors(aside, 2);
		}
		if (cfg.hideTimelineFollowSuggestions) {
			const primary = document.querySelector('[data-testid="primaryColumn"]');
			const followHeadingRe = /推荐关注|who to follow/i;
			const followHeadings = [
				...(primary?.querySelectorAll("h2") ?? []),
			].filter((h) => followHeadingRe.test(h.textContent ?? ""));
			const hasTimelineHeading = followHeadings.length > 0;
			if (hasTimelineHeading) {
				// X may virtualize the heading into its own cell, separate from the
				// UserCell rows. Hide that heading cell as well to avoid a leftover
				// "Who to follow"/"推荐关注" label.
				for (const heading of followHeadings) {
					heading
						.closest<HTMLElement>('[data-testid="cellInnerDiv"]')
						?.setAttribute(CUSTOM_HIDDEN_ATTR, "");
				}
				for (const cell of primary?.querySelectorAll<HTMLElement>(
					`[data-testid="${"cellInnerDiv"}"]:has([data-testid="UserCell"]), [data-testid="cellInnerDiv"]:has(a[href^="/i/connect_people"])`,
				) ?? [])
					cell.setAttribute(CUSTOM_HIDDEN_ATTR, "");
			}
		}
		if (cfg.hideDiscoverMore && options.isStatusPage()) {
			for (const heading of document.querySelectorAll<HTMLElement>(
				'h2[role="heading"][aria-level="2"]',
			)) {
				if (!/发现更多|discover more/i.test(heading.textContent ?? ""))
					continue;
				const cell = heading.closest<HTMLElement>(
					'[data-testid="cellInnerDiv"]',
				);
				if (!cell) continue;
				cell.setAttribute(CUSTOM_HIDDEN_ATTR, "");
				// Discover more is the final recommendation block on a status page;
				// its virtualized content is rendered as following sibling cells.
				for (
					let next = cell.nextElementSibling;
					next?.matches('[data-testid="cellInnerDiv"]');
					next = next.nextElementSibling
				)
					next.setAttribute(CUSTOM_HIDDEN_ATTR, "");
			}
		}
		if (cfg.hideLiveStreams) {
			for (const heading of document.querySelectorAll<HTMLElement>(
				'h2[role="heading"][aria-level="2"]',
			)) {
				if (!LIVE_STREAMS_HEADING_RE.test(heading.textContent?.trim() ?? ""))
					continue;
				// The module root is the closest ancestor that also contains the live
				// cards, identified by X's impression-tracking marker. Cap the climb so
				// a heading rendered in its own cell can never hide the whole page.
				let root: HTMLElement | null = heading.parentElement;
				for (let depth = 0; root && depth < 6; depth++) {
					if (root.querySelector('[data-testid="placementTracking"]')) break;
					root = root.parentElement;
				}
				if (root?.querySelector('[data-testid="placementTracking"]'))
					root.setAttribute(CUSTOM_HIDDEN_ATTR, "");
				const cell = heading.closest<HTMLElement>(
					'[data-testid="cellInnerDiv"]',
				);
				if (!cell) {
					// No cell wrapper: hide the heading and its direct wrappers.
					hideAncestors(heading, 2);
					continue;
				}
				cell.setAttribute(CUSTOM_HIDDEN_ATTR, "");
				// Live-stream rows render as following sibling cells carrying the same
				// marker; stop at the first cell without it so ordinary tweets after
				// the module are never hidden.
				for (
					let next = cell.nextElementSibling;
					next?.matches('[data-testid="cellInnerDiv"]');
					next = next.nextElementSibling
				) {
					if (!next.querySelector('[data-testid="placementTracking"]')) break;
					next.setAttribute(CUSTOM_HIDDEN_ATTR, "");
				}
			}
			// Mobile layout: live broadcasts render as a docked overlay in #layers —
			// a swipeable pill rail whose buttons are labelled "Broadcast, ..." or
			// "Space, ..." — instead of the desktop "Live on X" heading module.
			for (const rail of document.querySelectorAll<HTMLElement>(
				'#layers [data-testid="ScrollSnap-SwipeableList"]',
			)) {
				if (!isMobileLiveDockRail(rail)) continue;
				const dock = rail.closest<HTMLElement>("#layers > div") ?? rail;
				dock.setAttribute(CUSTOM_HIDDEN_ATTR, "");
			}
		}
		if (cfg.hideTrends) {
			for (const section of document.querySelectorAll<HTMLElement>(
				'section[role="region"]:has(> h1[role="heading"]):has([data-testid="trend"])',
			))
				hideAncestors(section, 1);
		}
		if (cfg.hideFooter) {
			for (const nav of document.querySelectorAll<HTMLElement>(
				'nav[role="navigation"]:has(a[href$="/tos"])',
			))
				hideAncestors(nav, 1);
		}
		if (cfg.hideNotificationBadges) {
			for (const badge of document.querySelectorAll<HTMLElement>(
				'[data-testid="AppTabBar_Home_Link"] svg + div[aria-label], [data-testid="AppTabBar_Notifications_Link"] svg + div[aria-label]',
			))
				badge.setAttribute(CUSTOM_HIDDEN_ATTR, "");
		}
		if (cfg.hideNewPostsPrompt) {
			for (const label of document.querySelectorAll<HTMLElement>(
				'[data-testid="primaryColumn"] [data-testid="pillLabel"]',
			)) {
				const button = findNewPostsPromptButton(label);
				if (button) hideAncestors(button, 0);
			}
		}
		if (cfg.hideGrokButton) {
			for (const drawer of document.querySelectorAll<HTMLElement>(
				'[data-testid="GrokDrawer"]',
			))
				hideAncestors(drawer, 2);
		}
		if (cfg.hideMessageButton) {
			for (const drawer of document.querySelectorAll<HTMLElement>(
				'[data-testid="chat-drawer-root"]',
			))
				hideAncestors(drawer, 2);
		}
	}

	function applyTitleAndFavicon(): void {
		if (!cfg) return;
		const hide = cfg.pageCleanupEnabled && cfg.hideTitleCount;
		if (hide && document.title && TITLE_COUNT_RE.test(document.title)) {
			titleBeforeCount ||= document.title;
			document.title = document.title.replace(TITLE_COUNT_RE, "");
		} else if (!hide && titleBeforeCount) {
			if (!TITLE_COUNT_RE.test(document.title))
				document.title = titleBeforeCount;
			titleBeforeCount = "";
		}
		const links =
			document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
		if (hide) {
			for (const link of links) {
				if (!originalFavicons.has(link)) originalFavicons.set(link, link.href);
				link.href = CLEAN_FAVICON;
			}
		} else {
			for (const [link, href] of originalFavicons)
				if (link.isConnected) link.href = href;
			originalFavicons.clear();
		}
	}

	function createComposeIcon(): SVGSVGElement {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("class", "bluenoise-compose-icon");
		svg.setAttribute(COMPOSE_ICON_MARK, "");
		const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
		for (const [pathData, fillRule] of [
			[
				"M10.938 4.5H9.9c-1.136 0-1.929 0-2.546.05-.605.05-.953.143-1.216.277-.564.288-1.023.747-1.31 1.31-.135.264-.228.612-.277 1.218C4.5 7.97 4.5 8.765 4.5 9.9v4.2c0 1.136 0 1.929.05 2.546.05.605.143.953.277 1.216.288.565.747 1.023 1.31 1.31.264.135.612.228 1.217.277.617.05 1.41.051 2.546.051h4.2c1.136 0 1.929 0 2.545-.05.606-.05.954-.143 1.217-.277.565-.288 1.023-.746 1.31-1.31.135-.264.228-.612.277-1.217.05-.617.051-1.41.051-2.546v-1.037h2V14.1c0 1.103.001 1.992-.058 2.709-.06.728-.185 1.368-.487 1.96-.48.941-1.245 1.707-2.185 2.186-.593.302-1.233.428-1.961.488-.718.058-1.606.057-2.71.057H9.9c-1.103 0-1.991.001-2.709-.058-.728-.06-1.368-.185-1.96-.487-.941-.48-1.707-1.245-2.186-2.185-.302-.593-.428-1.233-.487-1.961-.059-.718-.058-1.606-.058-2.71V9.9c0-1.103-.001-1.991.058-2.709.06-.728.185-1.368.487-1.96.48-.941 1.245-1.707 2.185-2.186.593-.302 1.233-.428 1.961-.487.718-.059 1.606-.058 2.71-.058h1.037v2z",
				undefined,
			],
			[
				"M16.293 3.293c1.219-1.219 3.195-1.219 4.414 0 1.219 1.219 1.219 3.195 0 4.414l-5.491 5.491c-.533.533-.89.896-1.31 1.179-.356.24-.742.433-1.148.574-.478.167-.983.234-1.729.341l-2.708.387.387-2.708c.107-.746.174-1.25.34-1.729.142-.405.335-.792.575-1.148.283-.42.646-.777 1.179-1.31l5.491-5.491zm3 1.414c-.438-.438-1.148-.438-1.586 0l-5.491 5.491c-.587.587-.784.79-.934 1.013-.144.214-.26.445-.345.688-.088.254-.131.533-.248 1.354l-.01.067.068-.008c.82-.118 1.1-.161 1.354-.25.243-.084.474-.2.688-.344.223-.15.426-.347 1.013-.934l5.491-5.491c.438-.438.438-1.148 0-1.586z",
				"evenodd",
			],
		] as const) {
			const path = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"path",
			);
			path.setAttribute("d", pathData);
			if (fillRule) {
				path.setAttribute("clip-rule", fillRule);
				path.setAttribute("fill-rule", fillRule);
			}
			group.append(path);
		}
		svg.append(group);
		return svg;
	}

	function restoreSidebarComposeIcons(): void {
		for (const [content, state] of composeOriginalChildren) {
			if (
				content.isConnected &&
				content.querySelector(`[${COMPOSE_ICON_MARK}]`)
			) {
				content.replaceChildren();
				content.append(state.originalChildren);
			}
		}
		composeOriginalChildren.clear();
		for (const button of document.querySelectorAll<HTMLElement>(
			"[data-bluenoise-compact-compose]",
		))
			button.removeAttribute("data-bluenoise-compact-compose");
	}

	function setSidebarStyle(element: HTMLElement, cssText: string): void {
		if (sidebarOriginalStyles.has(element)) return;
		sidebarOriginalStyles.set(element, element.style.cssText);
		element.style.cssText += `;${cssText}`;
	}

	function restoreSidebarStyles(): void {
		for (const [element, cssText] of sidebarOriginalStyles)
			if (element.isConnected) element.style.cssText = cssText;
		sidebarOriginalStyles.clear();
	}

	function setSidebarClasses(
		element: HTMLElement,
		remove: string[],
		add: string[],
	): void {
		if (!sidebarOriginalClasses.has(element))
			sidebarOriginalClasses.set(element, element.className);
		element.classList.remove(...remove);
		element.classList.add(...add);
	}

	function restoreSidebarClasses(): void {
		for (const [element, className] of sidebarOriginalClasses)
			if (element.isConnected) element.className = className;
		sidebarOriginalClasses.clear();
		for (const button of document.querySelectorAll<HTMLElement>(
			"[data-bluenoise-compact-account]",
		))
			button.removeAttribute("data-bluenoise-compact-account");
	}

	/** Remove width declarations written by earlier versions of this feature. */
	function clearLegacySidebarGeometry(element: HTMLElement): void {
		for (const property of [
			"width",
			"min-width",
			"max-width",
			"margin-left",
			"margin-right",
			"box-sizing",
			"flex",
			"transition",
		]) {
			if (element.style.getPropertyPriority(property) === "important")
				element.style.removeProperty(property);
		}
	}

	function applyCompactComposeClasses(button: HTMLAnchorElement): void {
		button.setAttribute("data-bluenoise-compact-compose", "");
		setSidebarStyle(
			button,
			"width:52px !important; min-width:52px !important; height:52px !important; min-height:52px !important; border-radius:9999px !important; display:flex !important; align-items:center !important; justify-content:center !important; padding:0 !important",
		);
		const container = button.parentElement;
		if (container instanceof HTMLElement)
			setSidebarStyle(
				container,
				"width:52px !important; min-width:52px !important; max-width:52px !important; margin-left:0 !important; margin-right:0 !important; align-self:flex-start !important",
			);
	}

	/**
	 * Switch the expanded sidebar shell to the same classes X uses when it renders
	 * compact navigation itself. Elements are located solely by stable structure.
	 */
	function applySidebarCompactLayout(): void {
		if (!cfg) return;
		if (!cfg.pageCleanupEnabled || !cfg.collapseSidebar) {
			restoreSidebarStyles();
			restoreSidebarClasses();
			return;
		}
		for (const header of document.querySelectorAll<HTMLElement>(
			'header[role="banner"]:has([data-testid="AppTabBar_Home_Link"])',
		)) {
			const widthContainer = header.querySelector<HTMLElement>(":scope > div");
			const layoutContainer = header.querySelector<HTMLElement>(
				":scope > div > div > div",
			);
			const sidebarColumn =
				layoutContainer?.querySelector<HTMLElement>(":scope > div");
			if (widthContainer) clearLegacySidebarGeometry(widthContainer);
			if (layoutContainer) clearLegacySidebarGeometry(layoutContainer);
			if (sidebarColumn) clearLegacySidebarGeometry(sidebarColumn);
			if (widthContainer)
				setSidebarClasses(widthContainer, ["r-o96wvk"], ["r-1gymjhz"]);
			if (layoutContainer)
				setSidebarClasses(layoutContainer, ["r-o96wvk"], ["r-1gymjhz"]);
			if (sidebarColumn)
				setSidebarClasses(sidebarColumn, ["r-1habvwh"], ["r-1awozwy"]);
			const nav = header.querySelector<HTMLElement>('nav[role="navigation"]');
			if (nav) {
				const navContainer = nav.parentElement;
				if (navContainer instanceof HTMLElement) {
					clearLegacySidebarGeometry(navContainer);
					setSidebarClasses(navContainer, ["r-1habvwh"], ["r-1awozwy"]);
				}
				clearLegacySidebarGeometry(nav);
				setSidebarClasses(nav, ["r-1habvwh"], ["r-1awozwy"]);
				for (const control of nav.querySelectorAll<HTMLElement>(
					":scope > a, :scope > button",
				)) {
					clearLegacySidebarGeometry(control);
					setSidebarClasses(control, ["r-1habvwh"], ["r-cnw61z", "r-1awozwy"]);
				}
			}
			const accountButton = header.querySelector<HTMLElement>(
				'[data-testid="SideNav_AccountSwitcher_Button"]',
			);
			if (accountButton) {
				accountButton.setAttribute("data-bluenoise-compact-account", "");
				const accountContainer = accountButton.parentElement;
				if (accountContainer instanceof HTMLElement)
					setSidebarClasses(accountContainer, ["r-1habvwh"], ["r-1awozwy"]);
				setSidebarClasses(accountButton, ["r-1habvwh"], ["r-1awozwy"]);
			}
		}
	}

	/** The expanded sidebar has no compose SVG, so reproduce X's compact DOM. */
	function applySidebarComposeIcons(): void {
		if (!cfg) return;
		if (!cfg.pageCleanupEnabled || !cfg.collapseSidebar) {
			restoreSidebarComposeIcons();
			return;
		}
		for (const button of document.querySelectorAll<HTMLAnchorElement>(
			'a[data-testid="SideNav_NewTweet_Button"]',
		)) {
			if (
				!button.closest(
					'header[role="banner"]:has([data-testid="AppTabBar_Home_Link"])',
				)
			)
				continue;
			const content = button.querySelector<HTMLElement>(":scope > div[dir]");
			if (!content) continue;
			const injectedIcon = content.querySelector<SVGSVGElement>(
				`:scope > svg[${COMPOSE_ICON_MARK}]`,
			);
			const nativeIcon = [...content.querySelectorAll(":scope > svg")].find(
				(svg) => svg !== injectedIcon,
			);
			// X can append its compact SVG after a partial expanded render. When that
			// happens, discard our temporary icon and preserve X's native one.
			if (nativeIcon) {
				const spacer = injectedIcon?.nextElementSibling;
				injectedIcon?.remove();
				if (spacer?.hasAttribute("data-bluenoise-compose-spacer"))
					spacer.remove();
				composeOriginalChildren.delete(content);
				continue;
			}
			if (injectedIcon) {
				applyCompactComposeClasses(button);
				continue;
			}
			const originalChildren = document.createDocumentFragment();
			while (content.firstChild) originalChildren.append(content.firstChild);
			composeOriginalChildren.set(content, {
				originalChildren,
			});
			applyCompactComposeClasses(button);
			content.append(createComposeIcon());
			const spacer = document.createElement("div");
			spacer.setAttribute("data-bluenoise-compose-spacer", "");
			const emptyLabel = document.createElement("span");
			spacer.append(emptyLabel);
			content.append(spacer);
		}
	}

	/** Effect switch: only touch one attribute and one CSS variable on <html>. */
	function applyLogo(): void {
		if (!cfg) return;
		const replace = cfg.pageCleanupEnabled && cfg.useBlueBird;
		const bird = replace ? getBirdData() : null;
		for (const svg of document.querySelectorAll<SVGSVGElement>(LOGO_SEL)) {
			const path = svg.querySelector("path");
			if (!path) continue;
			if (replace) {
				if (!svg.hasAttribute(BIRD_MARK)) {
					svg.setAttribute(BIRD_MARK, "");
					svg.dataset.bluenoiseOrigViewBox = svg.getAttribute("viewBox") ?? "";
					svg.dataset.bluenoiseOrigPath = path.getAttribute("d") ?? "";
					svg.dataset.bluenoiseOrigFill = path.getAttribute("fill") ?? "";
				}
				// X can reconcile the same SVG in place and restore its own path.
				// Re-apply the bird whenever the current path no longer matches it.
				if (
					path.getAttribute("d") === bird?.path &&
					svg.getAttribute("viewBox") === bird?.viewBox
				)
					continue;
				svg.setAttribute("viewBox", bird?.viewBox ?? "0 0 248 204");
				path.setAttribute("d", bird?.path ?? "");
				path.setAttribute("fill", bird?.fill ?? "#1d9bf0");
			} else if (svg.hasAttribute(BIRD_MARK)) {
				svg.setAttribute(
					"viewBox",
					svg.dataset.bluenoiseOrigViewBox || "0 0 24 24",
				);
				if (svg.dataset.bluenoiseOrigPath)
					path.setAttribute("d", svg.dataset.bluenoiseOrigPath);
				if (svg.dataset.bluenoiseOrigFill) {
					path.setAttribute("fill", svg.dataset.bluenoiseOrigFill);
				} else {
					path.removeAttribute("fill");
				}
				svg.removeAttribute(BIRD_MARK);
				delete svg.dataset.bluenoiseOrigViewBox;
				delete svg.dataset.bluenoiseOrigPath;
				delete svg.dataset.bluenoiseOrigFill;
			}
		}
	}

	function setRootAttribute(name: string, enabled: boolean): void {
		if (enabled) document.documentElement.setAttribute(name, "");
		else document.documentElement.removeAttribute(name);
	}

	function apply(config: AppConfig): void {
		cfg = config;
		const enabled = config.pageCleanupEnabled;
		setRootAttribute(PREMIUM_ATTR, enabled && config.hidePremiumPromo);
		setRootAttribute(
			PREMIUM_FEATURE_PROMPT_ATTR,
			enabled && config.hidePremiumFeaturePrompt,
		);
		setRootAttribute(FOOTER_ATTR, enabled && config.hideFooter);
		setRootAttribute(TRENDS_ATTR, enabled && config.hideTrends);
		setRootAttribute(FOLLOW_ATTR, enabled && config.hideFollowSuggestions);
		setRootAttribute(TITLE_COUNT_ATTR, enabled && config.hideTitleCount);
		setRootAttribute(BADGES_ATTR, enabled && config.hideNotificationBadges);
		setRootAttribute(NEW_POSTS_ATTR, enabled && config.hideNewPostsPrompt);
		setRootAttribute(GROK_ATTR, enabled && config.hideGrokButton);
		setRootAttribute(MESSAGE_ATTR, enabled && config.hideMessageButton);
		setRootAttribute(SIDEBAR_ATTR, enabled && config.collapseSidebar);
		applySidebarCompactLayout();
		applySidebarComposeIcons();
		applyPageCustomizations();
		applyLogo();
	}

	return {
		apply,
		reset() {
			if (!cfg) return;
			apply({ ...cfg, pageCleanupEnabled: false });
		},
	};
}

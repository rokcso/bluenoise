import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import type { AppConfig, KeywordSubscription } from "@/src/contracts/config";
import {
	ACCOUNT_LIST_KEY,
	type AccountListSnapshot,
	DEFAULT_ACCOUNT_LIST_SOURCES,
	MXGA_DATA_URL,
	MXGA_REPO_URL,
} from "@/src/domain/account-list";
import { fetchKeywordSource } from "@/src/domain/keywords";
import {
	AccountFilterIcon,
	AppearanceIcon,
	DatabaseIcon,
	DiagnosticsIcon,
	ExternalLinkIcon,
	LayoutIcon,
	ListFilterIcon,
	LoaderIcon,
	MonitorIcon,
	MoonIcon,
	RefreshIcon,
	SearchIcon,
	SettingsIcon,
	ShieldCheckIcon,
	SlidersIcon,
	SunIcon,
	ToolbarIcon,
	UserSlashIcon,
} from "@/src/ui/icons";
import { useConfig } from "./useConfig";
import { useTheme } from "./useTheme";

export default function App() {
	const { config, update } = useConfig();

	useTheme(config?.theme);

	if (!config) {
		return <div className="p-4 text-sm text-x-muted">{t("loading")}</div>;
	}

	return (
		<main className="bluenoise-popup flex w-[440px] flex-col overflow-hidden bg-x-bg text-x-fg">
			<header className="flex items-center gap-3 border-b border-x-border px-6 pb-5 pt-5">
				<Logo />
				<div className="flex min-w-0 flex-1 flex-col">
					<span
						className="text-[17px] font-semibold leading-tight tracking-[-0.03em]"
						translate="no"
					>
						BlueNoise
					</span>
					<span className="mt-1 text-xs text-x-muted">{t("tagline")}</span>
				</div>
				<button
					type="button"
					aria-label={t("open_settings")}
					onClick={() =>
						window.open(
							chrome.runtime.getURL("options.html?section=general"),
							"_blank",
							"noopener",
						)
					}
					className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-x-muted transition-colors hover:bg-x-hover hover:text-x-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
				>
					<SettingsIcon aria-hidden="true" className="h-[18px] w-[18px]" />
				</button>
			</header>

			<div className="space-y-3 px-6 py-5">
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm font-medium text-x-fg">
						{t("filter_status_label")}
					</span>
					<MasterSwitch config={config} update={update} />
				</div>
				<EffectSettings compact config={config} update={update} />
			</div>
		</main>
	);
}

export type SettingsSection =
	| "general"
	| "keywords"
	| "accounts"
	| "filtering"
	| "customization";

/** Full configuration screen rendered from the extension's Options page. */
export function SettingsApp({
	activeSection = "keywords",
}: {
	activeSection?: SettingsSection;
}) {
	const { config, update } = useConfig();

	useTheme(config?.theme);

	useEffect(() => {
		if (config?.subscriptions?.some((s) => s.keywords === null)) {
			void chrome.runtime.sendMessage({ type: "XSF_ENSURE_SUBSCRIPTIONS" });
		}
	}, [config?.subscriptions]);

	if (!config) {
		return <div className="p-4 text-sm text-x-muted">{t("loading")}</div>;
	}

	return (
		<main className="bluenoise-options min-h-screen bg-x-bg text-x-fg">
			<div className="options-workspace" key={activeSection}>
				{activeSection === "general" && (
					<>
						<PageHeading title={t("general")} />
						<SettingsGroup
							label={t("appearance")}
							icon={AppearanceIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<GeneralSettings config={config} update={update} />
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("extension")}
							icon={ToolbarIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<ExtensionSettings config={config} update={update} />
							</SettingsPanel>
						</SettingsGroup>
					</>
				)}

				{activeSection === "keywords" && (
					<>
						<PageHeading title={t("keywords")} />
						<div className="options-panel-stack">
							<SettingsGroup
								label={t("my_keywords")}
								icon={ListFilterIcon}
								labelClassName="font-normal"
							>
								<div className="rules-keywords-control">
									<TextListEditor
										value={config.userKeywords}
										onChange={(v) => update({ userKeywords: v })}
										hint={t("my_keywords_hint")}
										placeholder={t("my_keywords_placeholder")}
									/>
								</div>
							</SettingsGroup>
							<SettingsGroup
								label={t("whitelist_title")}
								icon={ShieldCheckIcon}
								labelClassName="font-normal"
							>
								<div className="rules-keywords-control">
									<TextListEditor
										value={config.whitelist}
										onChange={(v) => update({ whitelist: v })}
										hint={t("whitelist_hint")}
										placeholder={t("whitelist_placeholder")}
									/>
								</div>
							</SettingsGroup>
							<SettingsGroup
								label={t("external_keywords")}
								icon={DatabaseIcon}
								labelClassName="font-normal"
							>
								<SettingsPanel>
									<SourceToggles config={config} update={update} />
								</SettingsPanel>
							</SettingsGroup>
						</div>
					</>
				)}

				{activeSection === "accounts" && (
					<>
						<PageHeading title={t("accounts")} />
						<SettingsGroup
							label={t("account_filtering")}
							icon={AccountFilterIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<AccountListSettings
									section="controls"
									config={config}
									update={update}
								/>
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("account_blacklist_title")}
							icon={UserSlashIcon}
							labelClassName="font-normal"
						>
							<AccountListSettings
								section="localBlacklist"
								config={config}
								update={update}
							/>
						</SettingsGroup>
						<SettingsGroup
							label={t("account_whitelist_title")}
							icon={ShieldCheckIcon}
							labelClassName="font-normal"
						>
							<AccountListSettings
								section="localWhitelist"
								config={config}
								update={update}
							/>
						</SettingsGroup>
						<SettingsGroup
							label={t("external_account_sources")}
							icon={DatabaseIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<AccountListSettings
									section="source"
									config={config}
									update={update}
								/>
							</SettingsPanel>
						</SettingsGroup>
					</>
				)}

				{activeSection === "customization" && (
					<>
						<PageHeading title={t("customization")} />
						<SettingsGroup
							label={t("customization_options")}
							icon={LayoutIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<XToggle
									label={t("hide_title_count")}
									hint={t("hide_title_count_hint")}
									checked={config.hideTitleCount}
									onChange={(v) => update({ hideTitleCount: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_notification_badges")}
									hint={t("hide_notification_badges_hint")}
									checked={config.hideNotificationBadges}
									onChange={(v) => update({ hideNotificationBadges: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_new_posts_prompt")}
									hint={t("hide_new_posts_prompt_hint")}
									checked={config.hideNewPostsPrompt}
									onChange={(v) => update({ hideNewPostsPrompt: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_grok_button")}
									hint={t("hide_grok_button_hint")}
									checked={config.hideGrokButton}
									onChange={(v) => update({ hideGrokButton: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_message_button")}
									hint={t("hide_message_button_hint")}
									checked={config.hideMessageButton}
									onChange={(v) => update({ hideMessageButton: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_premium_promo")}
									hint={t("hide_premium_promo_hint")}
									checked={config.hidePremiumPromo}
									onChange={(v) => update({ hidePremiumPromo: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_trends")}
									hint={t("hide_trends_hint")}
									checked={config.hideTrends}
									onChange={(v) => update({ hideTrends: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_follow_suggestions")}
									hint={t("hide_follow_suggestions_hint")}
									checked={config.hideFollowSuggestions}
									onChange={(v) => update({ hideFollowSuggestions: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_timeline_follow_suggestions")}
									hint={t("hide_timeline_follow_suggestions_hint")}
									checked={config.hideTimelineFollowSuggestions}
									onChange={(v) => update({ hideTimelineFollowSuggestions: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_footer")}
									hint={t("hide_footer_hint")}
									checked={config.hideFooter}
									onChange={(v) => update({ hideFooter: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("use_blue_bird")}
									hint={t("use_blue_bird_hint")}
									checked={config.useBlueBird}
									onChange={(v) => update({ useBlueBird: v })}
								/>
							</SettingsPanel>
						</SettingsGroup>
					</>
				)}

				{activeSection === "filtering" && (
					<>
						<PageHeading title={t("filtering")} />
						<SettingsGroup
							label={t("ads")}
							icon={SlidersIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<XToggle
									label={t("filter_media_ads")}
									hint={t("filter_media_ads_hint")}
									checked={config.filterMediaAds}
									onChange={(v) => update({ filterMediaAds: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("filter_card_ads")}
									hint={t("filter_card_ads_hint")}
									checked={config.filterCardAds}
									onChange={(v) => update({ filterCardAds: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("filter_parody_accounts")}
									hint={t("filter_parody_accounts_hint")}
									checked={config.filterParodyAccounts}
									onChange={(v) => update({ filterParodyAccounts: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("filter_fan_accounts")}
									hint={t("filter_fan_accounts_hint")}
									checked={config.filterFanAccounts}
									onChange={(v) => update({ filterFanAccounts: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("filter_commentary_accounts")}
									hint={t("filter_commentary_accounts_hint")}
									checked={config.filterCommentaryAccounts}
									onChange={(v) => update({ filterCommentaryAccounts: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("filter_automated_accounts")}
									hint={t("filter_automated_accounts_hint")}
									checked={config.filterAutomatedAccounts}
									onChange={(v) => update({ filterAutomatedAccounts: v })}
								/>
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("treatment")}
							icon={SlidersIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<EffectSettings
									compact
									description={t("filter_effect_hint")}
									config={config}
									update={update}
								/>
								{config.mode === "dim" && (
									<>
										<SettingsDivider />
										<XToggle
											label={t("reveal_on_hover")}
											hint={t("reveal_on_hover_hint")}
											checked={config.revealOnHover}
											onChange={(v) => update({ revealOnHover: v })}
										/>
									</>
								)}
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("matching")}
							icon={SearchIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<Advanced section="matching" config={config} update={update} />
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("diagnostics")}
							icon={DiagnosticsIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<Advanced
									section="diagnostics"
									config={config}
									update={update}
								/>
							</SettingsPanel>
						</SettingsGroup>
					</>
				)}
			</div>
		</main>
	);
}

function AccountListSettings({
	section,
	config,
	update,
}: {
	section: "controls" | "localBlacklist" | "localWhitelist" | "source";
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	const [snapshot, setSnapshot] = useState<AccountListSnapshot | undefined>();
	const [syncing, setSyncing] = useState(false);

	useEffect(() => {
		let active = true;
		chrome.storage.local.get(ACCOUNT_LIST_KEY).then((result) => {
			if (active)
				setSnapshot(
					result[ACCOUNT_LIST_KEY] as AccountListSnapshot | undefined,
				);
		});
		const onChanged = (
			changes: { [key: string]: chrome.storage.StorageChange },
			area: string,
		) => {
			if (area === "local" && changes[ACCOUNT_LIST_KEY]) {
				setSnapshot(
					changes[ACCOUNT_LIST_KEY].newValue as AccountListSnapshot | undefined,
				);
			}
		};
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			active = false;
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	async function sync() {
		setSyncing(true);
		try {
			await chrome.runtime.sendMessage({ type: "XSF_SYNC_ACCOUNT_LIST" });
		} finally {
			setSyncing(false);
		}
	}

	const status = snapshot
		? t(
				"account_status",
				String(snapshot.blacklistCount),
				String(snapshot.whitelistCount),
				new Intl.DateTimeFormat(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(snapshot.syncedAt),
			)
		: t("not_synced");
	if (section === "localBlacklist" || section === "localWhitelist") {
		const isBlacklist = section === "localBlacklist";
		return (
			<div className="rules-keywords-control">
				<TextListEditor
					value={
						isBlacklist ? config.accountBlacklist : config.accountWhitelist
					}
					onChange={(v) =>
						update(
							isBlacklist ? { accountBlacklist: v } : { accountWhitelist: v },
						)
					}
					hint={t(
						isBlacklist ? "account_blacklist_hint" : "account_whitelist_hint",
					)}
					placeholder={t(
						isBlacklist
							? "account_blacklist_placeholder"
							: "account_whitelist_placeholder",
					)}
				/>
			</div>
		);
	}
	if (section === "controls") {
		return (
			<XToggle
				label={t("account_lists_enabled")}
				hint={t("account_lists_enabled_hint")}
				checked={config.accountListEnabled}
				onChange={(v) => update({ accountListEnabled: v })}
			/>
		);
	}

	const source = DEFAULT_ACCOUNT_LIST_SOURCES[0];

	return (
		<div className={config.externalAccountListsEnabled ? "" : "opacity-70"}>
			<div className="flex items-center justify-between gap-4 py-3">
				<div className="min-w-0 flex-1">
					<a
						href={MXGA_REPO_URL}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-sm font-medium transition-colors hover:text-x-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
					>
						{source.name}
						<ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
					</a>
					<span className="mt-1 block truncate text-xs text-x-muted">
						{status}
					</span>
					<a
						href={MXGA_DATA_URL}
						target="_blank"
						rel="noreferrer"
						className="mt-1 block truncate text-xs text-x-muted underline decoration-x-border underline-offset-2 transition-colors hover:text-x-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
						title={t("account_source_link")}
					>
						{t("account_source_link")}
					</a>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={sync}
						disabled={syncing}
						className="flex cursor-pointer items-center gap-1 rounded-full border border-x-border px-2.5 py-1 text-xs text-x-fg hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{syncing ? (
							<LoaderIcon aria-hidden="true" className="h-3 w-3 animate-spin" />
						) : (
							<RefreshIcon aria-hidden="true" className="h-3 w-3" />
						)}
						{t("sync")}
					</button>
					<BinarySwitch
						checked={config.externalAccountListsEnabled}
						label={source.name}
						onChange={(v) => {
							update({ externalAccountListsEnabled: v });
							if (v)
								void chrome.runtime.sendMessage({
									type: "XSF_SYNC_ACCOUNT_LIST",
								});
						}}
					/>
				</div>
			</div>
		</div>
	);
}

/* ---------- Brand ---------- */

function Logo() {
	return (
		<div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-x-border bg-x-surface">
			<img
				src="/icons/icon-48.png"
				alt=""
				width={48}
				height={48}
				className="h-full w-full object-cover"
			/>
		</div>
	);
}

/* ---------- Master switch ---------- */

function MasterSwitch({
	config,
	update,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	return (
		<BinarySwitch
			checked={config.enabled}
			label={config.enabled ? t("enabled_on") : t("enabled_off")}
			onChange={(enabled) => update({ enabled })}
		/>
	);
}

/** Shared binary switch with an in-rail thumb for both states. */
function BinarySwitch({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`binary-switch ${checked ? "is-on" : "is-off"}`}
		>
			<span className="binary-switch-track" aria-hidden="true" />
			<span className="binary-switch-thumb" aria-hidden="true" />
		</button>
	);
}

/* ---------- Effect settings (segmented control + slider) ---------- */

function EffectSettings({
	config,
	update,
	compact = false,
	description,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
	compact?: boolean;
	description?: string;
}) {
	const options = [
		{ value: "dim", label: t("mode_dim") },
		{ value: "hide", label: t("mode_hide") },
	] as const;
	const activeIndex = options.findIndex((o) => o.value === config.mode);

	return (
		<section>
			{compact ? (
				<SettingsRow
					label={t("filter_effect")}
					description={description}
					control={
						<div className="relative grid h-9 w-fit shrink-0 grid-cols-2 rounded-full border border-x-border bg-x-bg p-1">
							<div
								className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-full bg-x-accent transition-transform duration-200"
								style={{ transform: `translateX(${activeIndex * 100}%)` }}
							/>
							{options.map((opt) => (
								<button
									key={opt.value}
									type="button"
									onClick={() => update({ mode: opt.value })}
									aria-pressed={config.mode === opt.value}
									className={`relative z-10 cursor-pointer rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline-none ${
										config.mode === opt.value
											? "text-x-accent-fg"
											: "text-x-muted hover:text-x-fg"
									}`}
								>
									{opt.label}
								</button>
							))}
						</div>
					}
				/>
			) : (
				<>
					<span className="mb-2 block">
						<span className="text-xs font-medium text-x-muted">
							{t("filter_effect")}
						</span>
						{description && (
							<span className="text-xs leading-5 text-x-muted">
								{description}
							</span>
						)}
					</span>
					<div className="relative grid h-10 w-full grid-cols-2 rounded-lg border border-x-border bg-x-bg p-1">
						<div
							className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-md bg-x-accent transition-transform duration-200"
							style={{ transform: `translateX(${activeIndex * 100}%)` }}
						/>
						{options.map((opt) => (
							<button
								key={opt.value}
								type="button"
								onClick={() => update({ mode: opt.value })}
								aria-pressed={config.mode === opt.value}
								className={`relative z-10 cursor-pointer rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none ${
									config.mode === opt.value
										? "text-x-accent-fg"
										: "text-x-muted hover:text-x-fg"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
				</>
			)}
		</section>
	);
}

/* ---------- Accordion ---------- */

function PageHeading({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<header className="options-page-heading">
			<h1 className="options-page-title">{title}</h1>
			{description && <p>{description}</p>}
		</header>
	);
}

function SettingsGroup({
	label,
	description,
	icon: Icon,
	labelClassName,
	children,
}: {
	label: string;
	description?: string;
	icon?: React.ElementType;
	labelClassName?: string;
	children: React.ReactNode;
}) {
	return (
		<section className="settings-group">
			<div className="settings-group-label">
				<div className="flex items-center gap-2">
					{Icon && <Icon className="h-4 w-4 text-x-muted" aria-hidden="true" />}
					<h2 className={labelClassName}>{label}</h2>
				</div>
				{description && <p>{description}</p>}
			</div>
			{children}
		</section>
	);
}

function SettingsPanel({ children }: { children: React.ReactNode }) {
	return (
		<section className="settings-panel">
			<div className="settings-panel-body">{children}</div>
		</section>
	);
}

function SettingsRow({
	label,
	description,
	control,
}: {
	label: React.ReactNode;
	description?: string;
	control: React.ReactNode;
}) {
	return (
		<div className="settings-row">
			<div className="settings-row-copy">
				<span className="text-sm">{label}</span>
				{description && (
					<span className="settings-row-description">{description}</span>
				)}
			</div>
			{control}
		</div>
	);
}

function SettingsDivider() {
	return <div className="settings-divider" aria-hidden="true" />;
}

/* ---------- Sources ---------- */

function SourceToggles({
	config,
	update,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	return (
		<div className="flex flex-col">
			{config.subscriptions.map((source, index) => (
				<div key={source.id}>
					{index > 0 && <SettingsDivider />}
					<SourceToggle source={source} config={config} update={update} />
				</div>
			))}
		</div>
	);
}

function SourceToggle({
	source,
	config,
	update,
}: {
	source: KeywordSubscription;
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	const [syncing, setSyncing] = useState(false);
	const [error, setError] = useState("");
	async function sync() {
		setSyncing(true);
		setError("");
		try {
			const words = await fetchKeywordSource(source);
			update({
				subscriptions: config.subscriptions.map((s) =>
					s.id === source.id
						? { ...s, keywords: words, syncedAt: Date.now() }
						: s,
				),
			});
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setSyncing(false);
		}
	}

	const subtitle = source.keywords
		? t(
				source.keywords.length === 1
					? "keyword_count_one"
					: "keyword_count_other",
				String(source.keywords.length),
			)
		: t("not_synced");
	const syncStatus = source.syncedAt
		? `${subtitle} · ${t("last_synced", new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(source.syncedAt))}`
		: subtitle;
	return (
		<div className={source.enabled ? "" : "opacity-70"}>
			<div className="flex items-center justify-between gap-4 py-3">
				<div className="min-w-0 flex-1">
					<a
						href={source.homepageUrl}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-sm font-medium transition-colors hover:text-x-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
					>
						{source.name}
						<ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
					</a>
					<span className="mt-1 block text-xs text-x-muted">{syncStatus}</span>
					<a
						href={source.url}
						target="_blank"
						rel="noreferrer"
						className="mt-1 block truncate text-xs text-x-muted underline decoration-x-border underline-offset-2 transition-colors hover:text-x-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
						title={source.url}
					>
						{source.url}
					</a>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={sync}
						disabled={syncing}
						className="flex cursor-pointer items-center gap-1 rounded-full border border-x-border px-2.5 py-1 text-xs text-x-fg hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{syncing ? (
							<LoaderIcon aria-hidden="true" className="h-3 w-3 animate-spin" />
						) : (
							<RefreshIcon aria-hidden="true" className="h-3 w-3" />
						)}
						{t("sync")}
					</button>
					<BinarySwitch
						checked={source.enabled}
						label={source.name}
						onChange={(enabled) =>
							update({
								subscriptions: config.subscriptions.map((s) =>
									s.id === source.id ? { ...s, enabled } : s,
								),
							})
						}
					/>
				</div>
			</div>

			{error && <p className="pb-3 break-words text-xs text-x-red">{error}</p>}
		</div>
	);
}

/* ---------- Keywords / whitelist textareas ---------- */

function TextListEditor({
	value,
	onChange,
	hint,
	placeholder,
}: {
	value: string[];
	onChange: (v: string[]) => void;
	hint: string;
	placeholder: string;
}) {
	const [draft, setDraft] = useState(value.join("\n"));

	useEffect(() => {
		setDraft(value.join("\n"));
	}, [value]);

	function commit(next: string) {
		onChange(
			next
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		);
	}

	return (
		<label className="keyword-editor flex flex-col gap-1.5">
			<span className="text-xs text-x-muted">{hint}</span>
			<textarea
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={(e) => commit(e.target.value)}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						commit(draft);
						e.currentTarget.blur();
					}
				}}
				name="keywords"
				autoComplete="off"
				autoCapitalize="none"
				autoCorrect="off"
				spellCheck={false}
				placeholder={placeholder}
				className="keyword-editor-input w-full resize-y rounded-lg border border-x-border bg-x-bg p-3 font-mono text-xs text-x-fg outline-none focus:border-x-accent focus-visible:ring-2 focus-visible:ring-x-accent/30"
			/>
		</label>
	);
}

/* ---------- Advanced ---------- */

function Advanced({
	section,
	config,
	update,
}: {
	section: "matching" | "diagnostics";
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	return (
		<div className="flex flex-col">
			{section === "matching" ? (
				<>
					<XToggle
						label={t("match_names")}
						hint={t("match_names_hint")}
						checked={config.matchNames}
						onChange={(v) => update({ matchNames: v })}
					/>
					<SettingsDivider />
					<XToggle
						label={t("ignore_spaces")}
						hint={t("ignore_spaces_hint")}
						checked={config.ignoreSpaces}
						onChange={(v) => update({ ignoreSpaces: v })}
					/>
					<SettingsDivider />
					<XToggle
						label={t("case_sensitive")}
						hint={t("case_sensitive_hint")}
						checked={config.caseSensitive}
						onChange={(v) => update({ caseSensitive: v })}
					/>
				</>
			) : (
				<XToggle
					label={t("debug_logging")}
					hint={t("debug_logging_hint")}
					checked={config.debugLogging}
					onChange={(v) => update({ debugLogging: v })}
				/>
			)}
		</div>
	);
}

function GeneralSettings({
	config,
	update,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	const themeOptions = [
		{
			value: "auto",
			label: t("theme_auto"),
			icon: <MonitorIcon aria-hidden="true" className="h-3.5 w-3.5" />,
		},
		{
			value: "light",
			label: t("theme_light"),
			icon: <SunIcon aria-hidden="true" className="h-3.5 w-3.5" />,
		},
		{
			value: "dark",
			label: t("theme_dark"),
			icon: <MoonIcon aria-hidden="true" className="h-3.5 w-3.5" />,
		},
	] as const;
	const activeIndex = themeOptions.findIndex(
		(opt) => opt.value === config.theme,
	);
	return (
		<div className="flex flex-col">
			<SettingsRow
				label={t("theme")}
				description={t("theme_hint")}
				control={
					<div className="relative grid shrink-0 grid-cols-3 rounded-full border border-x-border bg-x-bg p-1">
						<div
							className="theme-segment-indicator absolute bottom-1 left-1 top-1 w-[calc(33.333%_-_4px)] rounded-full bg-x-accent transition-transform duration-200"
							style={{ transform: `translateX(${activeIndex * 100}%)` }}
						/>
						{themeOptions.map((opt) => (
							<button
								key={opt.value}
								type="button"
								onClick={() => update({ theme: opt.value })}
								aria-pressed={config.theme === opt.value}
								className={`relative z-10 flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
									config.theme === opt.value
										? "bg-x-accent text-x-accent-fg"
										: "text-x-muted hover:text-x-fg"
								}`}
							>
								{opt.icon}
								{opt.label}
							</button>
						))}
					</div>
				}
			/>
			<SettingsDivider />
			<SettingsRow
				label={t("language")}
				description={t("language_hint")}
				control={
					<select
						value={config.language}
						onChange={(event) =>
							update({ language: event.target.value as AppConfig["language"] })
						}
						className="cursor-pointer self-center rounded-lg border border-x-border bg-x-bg px-2.5 py-1.5 text-xs text-x-fg outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
					>
						<option value="auto">{t("language_auto")}</option>
						<option value="zh_CN">{t("language_chinese")}</option>
						<option value="en">{t("language_english")}</option>
					</select>
				}
			/>
		</div>
	);
}

function ExtensionSettings({
	config,
	update,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	return (
		<XToggle
			label={t("show_badge_count")}
			hint={t("show_badge_count_hint")}
			checked={config.showBadgeCount}
			onChange={(showBadgeCount) => update({ showBadgeCount })}
		/>
	);
}

function XToggle({
	label,
	checked,
	onChange,
	hint,
}: {
	label: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	hint?: string;
}) {
	return (
		<SettingsRow
			label={label}
			description={hint}
			control={
				<BinarySwitch checked={checked} label={label} onChange={onChange} />
			}
		/>
	);
}

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type {
	KeywordSubscription,
	RuleView,
	AppConfig as SettingsConfig,
} from "@/src/contracts/config";
import { RULE_DATA_KEY } from "@/src/contracts/config";
import {
	type AccountListSnapshot,
	DEFAULT_ACCOUNT_LIST_SOURCES,
	MXGA_DATA_URL,
	MXGA_REPO_URL,
} from "@/src/domain/account-list";
import { defaultRuleData } from "@/src/domain/defaults";
import { fetchKeywordSource } from "@/src/domain/keywords";
import { loadRuleData } from "@/src/domain/rules";
import {
	applyUserRulesImport,
	exportUserRules,
	type ImportPreview,
	parseUserRulesImport,
} from "@/src/domain/user-rules-transfer";

type AppConfig = SettingsConfig & RuleView;

import {
	AppearanceIcon,
	DatabaseIcon,
	DiagnosticsIcon,
	DownloadIcon,
	ExternalLinkIcon,
	EyeOffIcon,
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
	TwitterIcon,
	UploadIcon,
	UserSlashIcon,
	XFillIcon,
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
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5 text-sm font-medium text-x-fg">
						<XFillIcon aria-label={t("x_platform")} className="h-4 w-4" />
						{t("makeover")}
					</span>
					<PageCleanupSwitch config={config} update={update} />
				</div>
			</div>
		</main>
	);
}

export type SettingsSection =
	| "general"
	| "keywords"
	| "accounts"
	| "backup"
	| "filtering"
	| "advanced"
	| "makeover"
	| "about";

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

				{activeSection === "backup" && (
					<>
						<PageHeading title={t("rule_backup_title")} />
						<SettingsGroup
							label={t("rule_backup")}
							icon={DatabaseIcon}
							labelClassName="font-normal"
						>
							<UserRulesTransfer config={config} update={update} />
						</SettingsGroup>
					</>
				)}

				{activeSection === "makeover" && (
					<>
						<PageHeading
							title={
								<>
									<XPlatformIcon /> {t("makeover")}
								</>
							}
						/>
						<SettingsGroup
							label={t("makeover_layout")}
							icon={LayoutIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<XToggle
									label={t("collapse_sidebar")}
									hint={t("collapse_sidebar_hint")}
									checked={config.collapseSidebar}
									onChange={(v) => update({ collapseSidebar: v })}
								/>
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("makeover_distractions")}
							icon={EyeOffIcon}
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
									label={t("hide_discover_more")}
									hint={t("hide_discover_more_hint")}
									checked={config.hideDiscoverMore}
									onChange={(v) => update({ hideDiscoverMore: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("hide_footer")}
									hint={t("hide_footer_hint")}
									checked={config.hideFooter}
									onChange={(v) => update({ hideFooter: v })}
								/>
								<SettingsDivider />
							</SettingsPanel>
						</SettingsGroup>
						<SettingsGroup
							label={t("makeover_branding")}
							icon={XPlatformIcon}
							labelClassName="font-normal"
						>
							<SettingsPanel>
								<XToggle
									label={
										<>
											{t("hide_premium_promo_before_platform")}
											<XPlatformIcon />
											{t("hide_premium_promo_after_platform")}
										</>
									}
									switchLabel={`${t("hide_premium_promo")} ${t("x_platform")}`}
									hint={t("hide_premium_promo_hint")}
									checked={config.hidePremiumPromo}
									onChange={(v) => update({ hidePremiumPromo: v })}
								/>
								<SettingsDivider />
								<XToggle
									label={t("use_blue_bird")}
									hint={
										<>
											{t("use_blue_bird_hint_before")}
											<XPlatformIcon />
											{t("use_blue_bird_hint_between")}
											<TwitterPlatformIcon />
											{t("use_blue_bird_hint_after")}
										</>
									}
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
							label={t("content_filters")}
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
								<XToggle
									label={t("show_actual_reply_count")}
									hint={t("show_actual_reply_count_hint")}
									checked={config.showActualReplyCount}
									onChange={(v) => update({ showActualReplyCount: v })}
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
					</>
				)}

				{activeSection === "advanced" && (
					<>
						<PageHeading title={t("advanced")} />
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

				{activeSection === "about" && <AboutPage />}
			</div>
		</main>
	);
}

function AboutPage() {
	const version = chrome.runtime.getManifest().version;

	return (
		<>
			<PageHeading
				title={t("about")}
				description={
					<>
						{t("about_intro_before_platform")}
						<XPlatformIcon />
						{t("about_intro_after_platform")}
					</>
				}
			/>
			<section className="about-hero" aria-labelledby="about-idea-title">
				<div className="about-brand" aria-hidden="true">
					<img src="/icons/icon-128.png" alt="" />
					<span>{version}</span>
				</div>
				<div>
					<h2 id="about-idea-title">{t("about_idea_title")}</h2>
					<p>
						<XPlatformIcon />
						{t("about_idea_body_after_platform")}
						<XPlatformIcon />
						{t("about_idea_body_after_api")}
					</p>
				</div>
			</section>
			<div className="about-grid">
				<section className="about-card" aria-labelledby="about-name-title">
					<h2 id="about-name-title">{t("about_name_title")}</h2>
					<p>{t("about_name_body")}</p>
				</section>
				<section className="about-card" aria-labelledby="about-open-title">
					<h2 id="about-open-title">{t("about_open_title")}</h2>
					<p>{t("about_open_body")}</p>
				</section>
			</div>
			<nav className="about-actions" aria-label={t("about_links_label")}>
				<a
					href="https://github.com/rokcso/bluenoise"
					target="_blank"
					rel="noreferrer"
					className="about-action about-action-primary"
				>
					{t("about_github")}
					<ExternalLinkIcon aria-hidden="true" />
				</a>
				<a
					href="https://x.com/intent/follow?screen_name=rokcso"
					target="_blank"
					rel="noreferrer"
					className="about-action"
				>
					{t("follow_maker")}
					<ExternalLinkIcon aria-hidden="true" />
				</a>
			</nav>
		</>
	);
}

function XPlatformIcon() {
	return (
		<XFillIcon
			aria-label={t("x_platform")}
			className="mx-0.5 inline-block h-[0.9em] w-[0.9em] align-[-0.12em]"
		/>
	);
}

function TwitterPlatformIcon() {
	return (
		<TwitterIcon
			aria-label={t("twitter_platform")}
			className="mx-0.5 inline-block h-[0.9em] w-[0.9em] align-[-0.12em] text-[#1D9BF0]"
		/>
	);
}

function AccountListSettings({
	section,
	config,
	update,
}: {
	section: "localBlacklist" | "localWhitelist" | "source";
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	const [snapshots, setSnapshots] = useState<
		Record<string, AccountListSnapshot>
	>({});
	const [syncingSource, setSyncingSource] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		chrome.storage.local.get(RULE_DATA_KEY).then((result) => {
			if (active)
				setSnapshots(loadRuleData(result[RULE_DATA_KEY]).accounts.external);
		});
		const onChanged = (
			changes: { [key: string]: chrome.storage.StorageChange },
			area: string,
		) => {
			if (area === "local" && changes[RULE_DATA_KEY]) {
				setSnapshots(
					loadRuleData(changes[RULE_DATA_KEY].newValue).accounts.external,
				);
			}
		};
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			active = false;
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	async function sync(sourceId: string) {
		setSyncingSource(sourceId);
		try {
			await chrome.runtime.sendMessage({
				type: "XSF_SYNC_ACCOUNT_LIST",
				sourceId,
			});
		} finally {
			setSyncingSource(null);
		}
	}
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
	const sources = DEFAULT_ACCOUNT_LIST_SOURCES;

	return (
		<div>
			{sources
				.map((source) => {
					const snapshot = snapshots[source.id];
					const status = snapshot
						? source.format === "one-per-line"
							? `${t("account_blacklist_count", String(snapshot.blacklistCount))} · ${t("last_synced", new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(snapshot.syncedAt))}`
							: t(
									"account_status",
									String(snapshot.blacklistCount),
									String(snapshot.whitelistCount),
									new Intl.DateTimeFormat(undefined, {
										dateStyle: "medium",
										timeStyle: "short",
									}).format(snapshot.syncedAt),
								)
						: t("not_synced");
					const enabled = config.accountSourceEnabled[source.id] ?? false;
					const metadata = snapshot?.syncError || status;
					return (
						<div
							key={source.id}
							className="flex items-center justify-between gap-4 py-3"
						>
							<div className="min-w-0 flex-1">
								<a
									href={source.homepageUrl ?? MXGA_REPO_URL}
									target="_blank"
									rel="noreferrer"
									className="inline-flex w-fit items-center gap-1 text-sm font-medium transition-colors hover:text-x-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
								>
									{source.name}
									<ExternalLinkIcon
										className="h-3.5 w-3.5"
										aria-hidden="true"
									/>
								</a>
								<span className="mt-1 block truncate text-xs text-x-muted">
									{metadata}
								</span>
								{source.format === "one-per-line" && (
									<a
										href={source.blacklistUrl}
										target="_blank"
										rel="noreferrer"
										className="mt-1 block truncate text-xs text-x-muted underline decoration-x-border underline-offset-2 transition-colors hover:text-x-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
										title={source.blacklistUrl}
									>
										{source.blacklistUrl}
									</a>
								)}
								{source.id === "mxga" && (
									<a
										href={MXGA_DATA_URL}
										target="_blank"
										rel="noreferrer"
										className="mt-1 block truncate text-xs text-x-muted underline decoration-x-border underline-offset-2 transition-colors hover:text-x-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
										title={t("account_source_link")}
									>
										{t("account_source_link")}
									</a>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<button
									type="button"
									onClick={() => void sync(source.id)}
									disabled={syncingSource !== null}
									className="flex cursor-pointer items-center gap-1 rounded-full border border-x-border px-2.5 py-1 text-xs text-x-fg hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{syncingSource === source.id ? (
										<LoaderIcon
											aria-hidden="true"
											className="h-3 w-3 animate-spin"
										/>
									) : (
										<RefreshIcon aria-hidden="true" className="h-3 w-3" />
									)}
									{t("sync")}
								</button>
								<BinarySwitch
									checked={enabled}
									label={source.name}
									onChange={(v) => {
										update({
											accountSourceEnabled: {
												...config.accountSourceEnabled,
												[source.id]: v,
											},
										});
										if (v)
											void chrome.runtime.sendMessage({
												type: "XSF_SYNC_ACCOUNT_LIST",
												sourceId: source.id,
											});
									}}
								/>
							</div>
						</div>
					);
				})
				.map((node, i) => (
					<div key={sources[i].id}>
						{i > 0 && <SettingsDivider />}
						{node}
					</div>
				))}
		</div>
	);
}

function UserRulesTransfer({
	config,
	update,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [message, setMessage] = useState("");
	const [pendingImport, setPendingImport] = useState<ImportPreview | null>(
		null,
	);
	const exportRules = () => {
		const rules = defaultRuleData();
		rules.keywords.user = {
			block: config.userKeywords,
			allow: config.whitelist,
		};
		rules.accounts.user = {
			block: config.accountBlacklist,
			allow: config.accountWhitelist,
		};
		const blob = new Blob([JSON.stringify(exportUserRules(rules), null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `bluenoise-user-rules-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};
	const importRules = async (file: File) => {
		try {
			const preview = parseUserRulesImport(await file.text(), {
				preserveDuplicates: true,
			});
			setPendingImport(preview);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		}
	};
	const applyImport = (mode: "replace" | "merge" | "append") => {
		if (!pendingImport) return;
		const current = defaultRuleData();
		current.keywords.user = {
			block: config.userKeywords,
			allow: config.whitelist,
		};
		current.accounts.user = {
			block: config.accountBlacklist,
			allow: config.accountWhitelist,
		};
		const next = applyUserRulesImport(current, pendingImport.rules, mode);
		update({
			userKeywords: next.keywords.user.block,
			whitelist: next.keywords.user.allow,
			accountBlacklist: next.accounts.user.block,
			accountWhitelist: next.accounts.user.allow,
		});
		setMessage(
			t(
				mode === "replace"
					? "rule_import_success_replace"
					: mode === "append"
						? "rule_import_success_append"
						: "rule_import_success_merge",
				String(pendingImport.ignored),
			),
		);
		setPendingImport(null);
	};
	return (
		<div>
			<SettingsPanel>
				<SettingsRow
					label={t("rule_export_title")}
					description={t("rule_export_description")}
					control={
						<button
							type="button"
							onClick={exportRules}
							className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-x-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
						>
							<DownloadIcon className="h-3.5 w-3.5" aria-hidden="true" />
							{t("rule_export_action")}
						</button>
					}
				/>
				<SettingsDivider />
				<SettingsRow
					label={t("rule_import_title")}
					description={t("rule_import_description")}
					control={
						<button
							type="button"
							onClick={() => input.current?.click()}
							className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-x-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-accent/40"
						>
							<UploadIcon className="h-3.5 w-3.5" aria-hidden="true" />
							{t("rule_import_action")}
						</button>
					}
				/>
			</SettingsPanel>
			<input
				ref={input}
				type="file"
				accept="application/json,.json"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void importRules(file);
					event.currentTarget.value = "";
				}}
			/>
			{message && <p className="mt-3 text-xs text-x-muted">{message}</p>}
			{pendingImport && (
				<ImportModeDialog
					preview={pendingImport}
					onCancel={() => setPendingImport(null)}
					onSelect={applyImport}
				/>
			)}
		</div>
	);
}

function ImportModeDialog({
	preview,
	onCancel,
	onSelect,
}: {
	preview: ImportPreview;
	onCancel: () => void;
	onSelect: (mode: "replace" | "merge" | "append") => void;
}) {
	const [mode, setMode] = useState<"replace" | "merge" | "append">("merge");
	const total =
		preview.rules.keywords.block.length +
		preview.rules.keywords.allow.length +
		preview.rules.accounts.block.length +
		preview.rules.accounts.allow.length;
	return (
		<div
			className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
			role="dialog"
			aria-modal="true"
			aria-label={t("rule_import_dialog_title")}
		>
			<div className="w-full max-w-md rounded-xl border border-x-border bg-x-bg p-5 shadow-xl">
				<h2 className="text-base font-semibold">
					{t("rule_import_dialog_title")}
				</h2>
				<p className="mt-2 text-sm text-x-muted">
					{t(
						"rule_import_dialog_summary",
						String(total),
						String(preview.ignored),
					)}
				</p>
				<div className="mt-4 grid gap-2">
					<button
						type="button"
						onClick={() => setMode("merge")}
						aria-pressed={mode === "merge"}
						className={`rounded-lg border p-3 text-left text-sm ${mode === "merge" ? "border-x-accent bg-x-hover" : "border-x-border"}`}
					>
						<strong>{t("rule_import_mode_merge")}</strong>
						<span className="mt-1 block text-xs text-x-muted">
							{t("rule_import_mode_merge_description")}
						</span>
					</button>
					<button
						type="button"
						onClick={() => setMode("append")}
						aria-pressed={mode === "append"}
						className={`rounded-lg border p-3 text-left text-sm ${mode === "append" ? "border-x-accent bg-x-hover" : "border-x-border"}`}
					>
						<strong>{t("rule_import_mode_append")}</strong>
						<span className="mt-1 block text-xs text-x-muted">
							{t("rule_import_mode_append_description")}
						</span>
					</button>
					<button
						type="button"
						onClick={() => setMode("replace")}
						aria-pressed={mode === "replace"}
						className={`rounded-lg border p-3 text-left text-sm text-x-red ${mode === "replace" ? "border-x-red bg-x-hover" : "border-x-red/20"}`}
					>
						<strong>{t("rule_import_mode_replace")}</strong>
						<span className="mt-1 block text-xs text-x-muted">
							{t("rule_import_mode_replace_description")}
						</span>
					</button>
				</div>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-full px-3 py-1.5 text-sm text-x-muted hover:bg-x-hover"
					>
						{t("cancel")}
					</button>
					<button
						type="button"
						onClick={() => onSelect(mode)}
						className="rounded-full bg-x-accent px-4 py-1.5 text-sm font-medium text-x-accent-fg"
					>
						{t("rule_import_confirm")}
					</button>
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

function PageCleanupSwitch({
	config,
	update,
}: {
	config: AppConfig;
	update: (p: Partial<AppConfig>) => void;
}) {
	return (
		<BinarySwitch
			checked={config.pageCleanupEnabled}
			label={
				config.pageCleanupEnabled ? t("x_makeover_on") : t("x_makeover_off")
			}
			onChange={(pageCleanupEnabled) => update({ pageCleanupEnabled })}
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
	title: React.ReactNode;
	description?: React.ReactNode;
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
	description?: React.ReactNode;
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
	switchLabel,
}: {
	label: React.ReactNode;
	checked: boolean;
	onChange: (v: boolean) => void;
	hint?: React.ReactNode;
	switchLabel?: string;
}) {
	return (
		<SettingsRow
			label={label}
			description={hint}
			control={
				<BinarySwitch
					checked={checked}
					label={
						switchLabel ?? (typeof label === "string" ? label : t("x_platform"))
					}
					onChange={onChange}
				/>
			}
		/>
	);
}

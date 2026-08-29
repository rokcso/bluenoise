import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp, type SettingsSection } from "../popup/App";
import { useConfig } from "../popup/useConfig";
import "../popup/style.css";
import "./style.css";
import { setLanguage, t } from "@/lib/i18n";
import {
	DatabaseIcon,
	FilterFillIcon,
	FilterIcon,
	InformationFillIcon,
	InformationIcon,
	ListFilterFillIcon,
	ListFilterIcon,
	MenuIcon,
	SettingsFillIcon,
	SettingsIcon,
	SlidersIcon,
	UsersFillIcon,
	UsersIcon,
	XFillIcon,
	XIcon,
} from "@/src/ui/icons";

const navigation: {
	id: SettingsSection;
	label: string;
	lineIcon: React.ElementType;
	fillIcon: React.ElementType;
}[] = [
	{
		id: "general",
		label: "general",
		lineIcon: SettingsIcon,
		fillIcon: SettingsFillIcon,
	},
	{
		id: "keyword-rules",
		label: "keywords",
		lineIcon: ListFilterIcon,
		fillIcon: ListFilterFillIcon,
	},
	{
		id: "account-rules",
		label: "accounts",
		lineIcon: UsersIcon,
		fillIcon: UsersFillIcon,
	},
	{
		id: "backup",
		label: "rule_backup",
		lineIcon: DatabaseIcon,
		fillIcon: DatabaseIcon,
	},
	{
		id: "filtering",
		label: "filtering",
		lineIcon: FilterIcon,
		fillIcon: FilterFillIcon,
	},
	{
		id: "advanced",
		label: "advanced",
		lineIcon: SlidersIcon,
		fillIcon: SlidersIcon,
	},
	{
		id: "makeover",
		label: "makeover",
		lineIcon: XFillIcon,
		fillIcon: XFillIcon,
	},
	{
		id: "about",
		label: "about",
		lineIcon: InformationIcon,
		fillIcon: InformationFillIcon,
	},
];

function sectionFromUrl(): SettingsSection {
	const section = new URLSearchParams(window.location.search).get("section");
	return navigation.some((item) => item.id === section)
		? (section as SettingsSection)
		: "general";
}

function OptionsPage() {
	const [section, setSection] = useState<SettingsSection>(sectionFromUrl);
	const [menuOpen, setMenuOpen] = useState(false);
	const { config } = useConfig();

	useEffect(() => {
		// Re-seed the catalog (cheap and idempotent) so the title follows the
		// user's chosen language, even before a full config reload.
		setLanguage(config?.language ?? "auto");
		document.title = t("options_title");
	}, [config?.language]);

	useEffect(() => {
		const onPopState = () => setSection(sectionFromUrl());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		if (!menuOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenuOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [menuOpen]);

	function navigate(section: SettingsSection) {
		window.history.pushState(null, "", `?section=${section}`);
		setSection(section);
		setMenuOpen(false);
	}

	return (
		<StrictMode>
			<div className="options-page">
				<aside className="options-sidebar">
					<div className="options-brand">
						<img src="/icons/icon-48.png" alt="" />
						<span>{t("settings_label")}</span>
					</div>
					<button
						type="button"
						className="options-menu-toggle"
						aria-expanded={menuOpen}
						aria-controls="options-nav"
						aria-label={t("settings_navigation")}
						onClick={() => setMenuOpen((open) => !open)}
					>
						<MenuIcon aria-hidden="true" />
					</button>
					<a
						className="options-author-link"
						href="https://x.com/intent/follow?screen_name=rokcso"
						target="_blank"
						rel="noreferrer"
						aria-label={t("follow_maker_aria")}
					>
						<XIcon aria-hidden="true" />
						<span>{t("follow_maker")}</span>
					</a>
					{menuOpen ? (
						<button
							type="button"
							className="options-backdrop"
							tabIndex={-1}
							aria-label={t("settings_navigation")}
							onClick={() => setMenuOpen(false)}
						/>
					) : null}
					<nav
						id="options-nav"
						className={`options-nav${menuOpen ? " is-open" : ""}`}
						aria-label={t("settings_navigation")}
					>
						{navigation.map((item) => (
							<a
								className={section === item.id ? "is-active" : undefined}
								key={item.id}
								href={`?section=${item.id}`}
								onClick={(event) => {
									if (
										event.button !== 0 ||
										event.metaKey ||
										event.ctrlKey ||
										event.shiftKey
									)
										return;
									event.preventDefault();
									navigate(item.id);
								}}
							>
								{(() => {
									const Icon =
										section === item.id ? item.fillIcon : item.lineIcon;
									return <Icon aria-hidden="true" />;
								})()}
								{t(item.label)}
							</a>
						))}
					</nav>
				</aside>
				<main className="options-shell">
					<SettingsApp activeSection={section} />
				</main>
			</div>
		</StrictMode>
	);
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

createRoot(rootEl).render(<OptionsPage />);

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp, type SettingsSection } from "../popup/App";
import { useConfig } from "../popup/useConfig";
import "../popup/style.css";
import "./style.css";
import { setLanguage, t } from "@/lib/i18n";
import {
	FilterFillIcon,
	FilterIcon,
	InformationFillIcon,
	InformationIcon,
	LayoutFillIcon,
	LayoutIcon,
	ListFilterFillIcon,
	ListFilterIcon,
	SettingsFillIcon,
	SettingsIcon,
	UsersFillIcon,
	UsersIcon,
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
		id: "keywords",
		label: "keywords",
		lineIcon: ListFilterIcon,
		fillIcon: ListFilterFillIcon,
	},
	{
		id: "accounts",
		label: "accounts",
		lineIcon: UsersIcon,
		fillIcon: UsersFillIcon,
	},
	{
		id: "filtering",
		label: "filtering",
		lineIcon: FilterIcon,
		fillIcon: FilterFillIcon,
	},
	{
		id: "customization",
		label: "customization",
		lineIcon: LayoutIcon,
		fillIcon: LayoutFillIcon,
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

	function navigate(section: SettingsSection) {
		window.history.pushState(null, "", `?section=${section}`);
		setSection(section);
	}

	return (
		<StrictMode>
			<div className="options-page">
				<aside className="options-sidebar">
					<div className="options-brand">
						<img src="/icons/icon-48.png" alt="" />
						<span>{t("settings_label")}</span>
					</div>
					<nav className="options-nav" aria-label={t("settings_navigation")}>
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

import { useState } from "react";
import { SlideCard } from "./SlideCard";
import { RatingButtons } from "./RatingButtons";
import { YamlCard } from "../types";
import { Phase, Rating } from "../hooks/usePlayback";

interface FlashcardViewerProps {
	card: YamlCard | null;
	fileName: string;
	cardIndex: number;
	displayType: "question" | "answer";
	isSpeaking: boolean;
	phase: Phase;
	title: string;
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	zoomed: boolean;
	onToggleZoom: () => void;
	onRate?: (rating: Rating) => void;
	queueRemaining?: number;
	pendingRating?: Rating | null;
	isQueueMode?: boolean;
	isCardActive?: boolean;
	isSpeechMode?: boolean;
	format?: "full" | "shorts";
	isSlidev?: boolean;
	captionsText?: string;
}

const toolbarBtnStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.06)",
	border: "1px solid rgba(255, 255, 255, 0.1)",
	color: "var(--text-secondary)",
	cursor: "pointer",
	padding: "6px 10px",
	borderRadius: "6px",
	fontSize: "13px",
	lineHeight: 1,
	display: "flex",
	alignItems: "center",
	gap: "4px",
};

export function FlashcardViewer({
	card,
	fileName,
	cardIndex,
	displayType,
	isSpeaking,
	phase,
	title,
	sidebarOpen,
	onToggleSidebar,
	zoomed,
	onToggleZoom,
	onRate,
	queueRemaining,
	pendingRating,
	isQueueMode,
	isCardActive,
	isSpeechMode = true,
	format,
	isSlidev,
	captionsText,
}: FlashcardViewerProps) {
	const [captionsEnabled, setCaptionsEnabled] = useState(false);
	if (!card) {
		return (
			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: "16px",
					color: "var(--text-secondary)",
					position: "relative",
				}}
			>
				{/* Toolbar when sidebar hidden */}
				{!sidebarOpen && (
					<div style={{ position: "absolute", top: "12px", left: "12px" }}>
						<button
							type="button"
							onClick={onToggleSidebar}
							title="Show sidebar (B)"
							style={toolbarBtnStyle}
						>
							&#x203a;
						</button>
					</div>
				)}
				<div
					style={{
						width: "80px",
						height: "80px",
						borderRadius: "20px",
						background: "rgba(255,255,255,0.05)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: "36px",
					}}
				>
					Q
				</div>
				<p style={{ fontSize: "18px", fontWeight: 500 }}>
					Select a topic to begin
				</p>
				<p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
					Choose a topic from the sidebar, then press Play
				</p>
			</div>
		);
	}

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: zoomed ? "12px" : "40px",
				gap: zoomed ? "8px" : "24px",
				overflow: "auto",
				position: "relative",
			}}
		>
			{/* Toolbar */}
			<div
				style={{
					position: "absolute",
					top: "12px",
					left: "12px",
					display: "flex",
					gap: "6px",
					zIndex: 10,
				}}
			>
				{!sidebarOpen && (
					<button
						type="button"
						onClick={onToggleSidebar}
						title="Show sidebar (B)"
						style={toolbarBtnStyle}
					>
						&#x203a;
					</button>
				)}
				<button
					type="button"
					onClick={onToggleZoom}
					title="Zoom to fit (F)"
					style={toolbarBtnStyle}
				>
					{zoomed ? "Exit zoom" : "Zoom"}
				</button>
				{isSlidev && (
					<button
						type="button"
						onClick={() => setCaptionsEnabled((v) => !v)}
						title="Toggle captions (C)"
						style={{
							...toolbarBtnStyle,
							background: captionsEnabled
								? "rgba(255,255,255,0.18)"
								: toolbarBtnStyle.background,
							borderColor: captionsEnabled
								? "rgba(255,255,255,0.35)"
								: (toolbarBtnStyle.border as string),
							color: captionsEnabled ? "#fff" : "var(--text-secondary)",
						}}
					>
						CC
					</button>
				)}
			</div>

			{/* Title */}
			{!zoomed && (
				<h2
					style={{
						fontSize: "14px",
						fontWeight: 500,
						color: "var(--text-secondary)",
						letterSpacing: "0.5px",
					}}
				>
					{title}
				</h2>
			)}

			{/* Slide card */}
			<SlideCard
				fileName={fileName}
				type={displayType}
				cardIndex={cardIndex}
				isSpeaking={isSpeaking}
				zoomed={zoomed}
				format={format}
			/>

			{/* Captions overlay – floats over the bottom of the screen area */}
			{isSlidev && captionsEnabled && captionsText && (
				<div
					style={{
						position: "absolute",
						bottom: 0,
						left: 0,
						right: 0,
						padding: "16px 32px 20px",
						background: "rgba(0, 0, 0, 0.72)",
						backdropFilter: "blur(6px)",
						WebkitBackdropFilter: "blur(6px)",
						color: "#fff",
						fontSize: "clamp(13px, 1.4vw, 17px)",
						lineHeight: 1.65,
						textAlign: "center",
						borderTop: "1px solid rgba(255,255,255,0.1)",
						boxSizing: "border-box",
						zIndex: 30,
					}}
				>
					{captionsText}
				</div>
			)}

			{/* Rating buttons (queue mode, floating overlay on top of slide) */}
			{isQueueMode && isCardActive && onRate && (
				<div
					style={{
						position: "absolute",
						bottom: "12px",
						left: "50%",
						transform: "translateX(-50%)",
						zIndex: 20,
					}}
				>
					<RatingButtons
						onRate={onRate}
						remaining={queueRemaining ?? 0}
						selected={pendingRating ?? null}
					/>
				</div>
			)}

			{/* Phase indicator */}
			{!zoomed && phase !== "idle" && phase !== "done" && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
						fontSize: "13px",
						color: "var(--text-secondary)",
					}}
				>
					{isSpeaking && (
						<span
							style={{
								display: "inline-block",
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								background:
									displayType === "question"
										? "var(--accent)"
										: "var(--accent-green)",
								animation: "pulse 1s ease-in-out infinite",
							}}
						/>
					)}
					<span>
						{phase === "q-speaking" && "Speaking question..."}
						{phase === "q-pause" && "Think about the answer..."}
						{phase === "a-speaking" && "Speaking answer..."}
						{phase === "a-pause" && "Next card coming up..."}
						{phase === "question" &&
							(isSpeechMode ? "Loading..." : "Press → to reveal answer")}
						{phase === "answer" &&
							(isSpeechMode
								? "Loading..."
								: isQueueMode
									? "Rate to continue"
									: "Press → for next card")}
					</span>
				</div>
			)}

			{!zoomed && phase === "done" && (
				<div
					style={{
						fontSize: "16px",
						fontWeight: 600,
						color: "var(--accent-green)",
					}}
				>
					All cards complete! Press R to restart.
				</div>
			)}

			{/* Pulse animation */}
			<style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
		</div>
	);
}

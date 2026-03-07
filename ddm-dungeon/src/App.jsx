import { useState, useEffect, useRef, useCallback } from "react";

// ─── GAME DATA ────────────────────────────────────────────────────────────────
const ROOMS = [
  {
    id: 1,
    title: "The Merchant's Offer",
    icon: "⚖",
    scenario:
      "A cloaked merchant materializes from the shadows. He spreads two contracts upon a crumbling altar, his eyes gleaming with something ancient.",
    choices: [
      {
        label: "Accept the sealed pouch — 10 gold coins, guaranteed.",
        value: 10,
        probability: 1.0,
        ev: 10,
      },
      {
        label:
          "Gamble on the jeweled box — 25 gold, but cursed 40% of the time.",
        value: 25,
        probability: 0.6,
        ev: 15,
      },
    ],
    optimalIdx: 1,
    evidence:
      "You notice fresh scratches on the iron lock — the box has been opened recently. Others survived.",
    drift_signal: 0.6,
  },
  {
    id: 2,
    title: "The Cursed Chest",
    icon: "⚰",
    scenario:
      "Two chests rest on a stone dais slick with old blood. Ancient runes carve themselves slowly into the walls around you. Your torch gutters.",
    choices: [
      {
        label: "Pry open the iron chest — certain 5 gold, no risk.",
        value: 5,
        probability: 1.0,
        ev: 5,
      },
      {
        label: "Break the ornate seal — 80% chance of 8 gold inside.",
        value: 8,
        probability: 0.8,
        ev: 6.4,
      },
    ],
    optimalIdx: 1,
    evidence:
      "The ornate chest's runes pulse with a steady rhythm — a warding sign, not a curse.",
    drift_signal: 0.7,
  },
  {
    id: 3,
    title: "The Fork in the Path",
    icon: "⛧",
    scenario:
      "Two tunnels cleave the darkness ahead. Scouts who ventured both returned — but one lost two fingers. You must choose before the torchlight dies.",
    choices: [
      {
        label: "Left passage — 30% ambush risk, reward of 20 gold.",
        value: 20,
        probability: 0.7,
        ev: 14,
      },
      {
        label: "Right passage — 10% ambush risk, reward of 12 gold.",
        value: 12,
        probability: 0.9,
        ev: 10.8,
      },
    ],
    optimalIdx: 0,
    evidence:
      "Fresh boot-prints lead left. The scout who lost fingers went right.",
    drift_signal: 0.4,
  },
  {
    id: 4,
    title: "The Dragon's Demand",
    icon: "🐉",
    scenario:
      "A young wyvern coils around the passage ahead, scales still soft. It bares its teeth — either you pay tribute, or you gamble on steel.",
    choices: [
      {
        label: "Offer tribute — lose 8 gold, pass unharmed.",
        value: -8,
        probability: 1.0,
        ev: -8,
      },
      {
        label:
          "Draw your blade — 40% to win 15 gold, 60% to flee losing only 3.",
        value: 15,
        probability: 0.4,
        ev: 0.6,
      },
    ],
    optimalIdx: 1,
    evidence:
      "The wyvern's wing is scarred — it has fled before. It may again.",
    drift_signal: 0.3,
  },
  {
    id: 5,
    title: "The Final Gate",
    icon: "🗝",
    scenario:
      "The dungeon's last threshold stands before you. The gatekeeper — a skeletal figure in iron robes — extends both hands. One key, one exit, one chance.",
    choices: [
      {
        label: "Take the golden key — 95% opens the gate, 30 gold reward.",
        value: 30,
        probability: 0.95,
        ev: 28.5,
      },
      {
        label: "Seize the silver key — 50% opens the gate, 50 gold reward.",
        value: 50,
        probability: 0.5,
        ev: 25,
      },
    ],
    optimalIdx: 0,
    evidence:
      "The golden key is warm — enchanted. The silver key smells of failure.",
    drift_signal: 0.8,
  },
];

const TIME_LIMIT = 10000; // Kept time limit at 10 seconds
const EVIDENCE_DELAY = 2000; // Adjusted evidence delay for more reading time

function getDecisionExplanation(room, choiceIdx, rt, timedOut) {
  const chosen = room.choices[choiceIdx];
  const optimal = room.choices[room.optimalIdx];
  const choseOptimal = choiceIdx === room.optimalIdx;
  const seconds = (rt / 1000).toFixed(2);
  const speed =
    rt < TIME_LIMIT * 0.45
      ? "fast"
      : rt < TIME_LIMIT * 0.8
        ? "moderate"
        : "slow";

  const ddmLine =
    "DDM view: Drift rate (v) is how strongly evidence pushes you toward one option over another. " +
    `Here, your ${speed} (${seconds}s) choice of ${choseOptimal ? "the higher-EV option" : "the lower-EV option"} suggests ` +
    `${choseOptimal ? "the available evidence produced a clearer signal for you" : "the evidence signal was weaker or noisier for you"}.`;

  const boundedLine =
    "Bounded/resource-rational view: You trade off reward and cognitive/time cost. " +
    `${
      timedOut
        ? "Because time ran out, the policy effectively favored low mental effort over expected value optimization."
        : `You selected an option with EV ${chosen.ev.toFixed(1)} vs ${optimal.ev.toFixed(1)} for the best available option, ` +
          `which means this choice was ${choseOptimal ? "resource-rational under this task" : "a satisficing tradeoff rather than the utility-maximizing action"}.`
    }`;

  const evComparison =
    `Expected Value (EV) comparison: The chosen option had an EV of ${chosen.ev.toFixed(1)}, while the optimal option had an EV of ${optimal.ev.toFixed(1)}. ` +
    `${choseOptimal ? "This indicates a strong alignment with maximizing expected rewards." : "This suggests a deviation from the optimal reward strategy."}`;

  return { ddmLine, boundedLine, evComparison };
}

// ─── SCORING ──────────────────────────────────────────────────────────────────
function estimateDriftRate(decisions) {
  const correct = decisions.filter((d) => d.choseOptimal).length;
  const accuracy = correct / decisions.length;
  const avgRT = decisions.reduce((s, d) => s + d.rt, 0) / decisions.length;
  const normRT = Math.min(avgRT / TIME_LIMIT, 1);
  return Math.max(0.1, accuracy * (1 - normRT * 0.5) * 3).toFixed(2);
}

function estimateThreshold(decisions) {
  const avgRT = decisions.reduce((s, d) => s + d.rt, 0) / decisions.length;
  return Math.max(0.5, (avgRT / TIME_LIMIT) * 4).toFixed(2);
}

function computeBayesScore(decisions) {
  let logOdds = 0;
  decisions.forEach((d, i) => {
    const sig = ROOMS[i].drift_signal;
    logOdds += d.choseOptimal
      ? Math.log(sig / (1 - sig))
      : Math.log((1 - sig) / sig);
  });
  return (100 / (1 + Math.exp(-logOdds))).toFixed(1);
}

function computeResourceScore(decisions) {
  let totalEV = 0,
    totalTimeCost = 0;
  decisions.forEach((d, i) => {
    totalEV += ROOMS[i].choices[d.choiceIdx].ev;
    totalTimeCost += d.rt / TIME_LIMIT;
  });
  return (totalEV - 0.3 * totalTimeCost * 10).toFixed(1);
}

function getDecisionStyle(v, a, bs) {
  const vn = parseFloat(v),
    an = parseFloat(a),
    bn = parseFloat(bs);
  if (vn > 2.0 && an < 1.5)
    return {
      label: "The Berserker",
      color: "#e03131",
      desc: "You charged without thought — pure instinct, heedless of consequence.",
    };
  if (vn > 1.5 && an > 2.0)
    return {
      label: "The Strategist",
      color: "#f59f00",
      desc: "Swift yet deliberate. You read the signs and trusted what you saw.",
    };
  if (vn < 1.0 && an > 2.5)
    return {
      label: "The Scholar",
      color: "#748ffc",
      desc: "You weighed every shadow before stepping. Caution was your blade.",
    };
  if (bn > 70)
    return {
      label: "The Oracle",
      color: "#cc5de8",
      desc: "Your choices aligned with optimal belief — you updated on evidence.",
    };
  if (vn < 1.2 && an < 1.5)
    return {
      label: "The Lost Soul",
      color: "#868e96",
      desc: "The fog of uncertainty swallowed your signal. Evidence was noise.",
    };
  return {
    label: "The Wanderer",
    color: "#94d82d",
    desc: "Neither reckless nor overcautious — you navigated with quiet pragmatism.",
  };
}

// ─── EVIDENCE BAR ─────────────────────────────────────────────────────────────
function EvidenceBar({ progress }) {
  return (
    <div
      style={{
        width: "100%",
        height: "3px",
        background: "rgba(180,120,40,0.15)",
        borderRadius: "2px",
        overflow: "hidden",
        marginBottom: "18px",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress * 100}%`,
          background: "linear-gradient(90deg, #c17d11, #f59f00, #ffe066)",
          borderRadius: "2px",
          transition: "width 0.1s linear",
          boxShadow: "0 0 10px rgba(240,160,0,0.6)",
        }}
      />
    </div>
  );
}

// ─── TIMER RING ───────────────────────────────────────────────────────────────
function TimerRing({ timeLeft, total }) {
  const pct = timeLeft / total;
  const r = 28,
    circ = 2 * Math.PI * r;
  const color = pct > 0.5 ? "#f59f00" : pct > 0.25 ? "#ff922b" : "#e03131";
  return (
    <svg
      width="70"
      height="70"
      style={{ display: "block", margin: "0 auto 14px" }}
    >
      <circle
        cx="35"
        cy="35"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="4"
      />
      <circle
        cx="35"
        cy="35"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 35 35)"
        style={{
          transition: "stroke-dashoffset 0.1s linear",
          filter: `drop-shadow(0 0 5px ${color})`,
        }}
      />
      <text
        x="35"
        y="40"
        textAnchor="middle"
        fill={color}
        fontSize="13"
        fontFamily="'Georgia', serif"
        fontWeight="bold"
      >
        {(timeLeft / 1000).toFixed(1)}
      </text>
    </svg>
  );
}

// ─── CHOICE BUTTON ────────────────────────────────────────────────────────────
function ChoiceButton({ choice, idx, onClick, revealed, disabled }) {
  const [hover, setHover] = useState(false);
  if (!revealed)
    return (
      <div
        style={{
          display: "block",
          width: "100%",
          padding: "18px 22px",
          marginBottom: "12px",
          borderRadius: "8px",
          background: "rgba(30,15,5,0.5)",
          border: "1px solid rgba(120,60,0,0.2)",
          height: "60px",
        }}
      />
    );
  return (
    <button
      onClick={() => !disabled && onClick(idx)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        padding: "18px 22px",
        marginBottom: "12px",
        cursor: disabled ? "default" : "pointer",
        background: hover ? "rgba(180,100,20,0.18)" : "rgba(20,10,5,0.6)",
        border: hover
          ? "1px solid rgba(240,160,0,0.55)"
          : "1px solid rgba(120,60,0,0.3)",
        borderRadius: "8px",
        color: hover ? "#ffe8b0" : "#c9a87a",
        fontSize: "13px",
        textAlign: "left",
        lineHeight: "1.5",
        transition: "all 0.18s ease",
        boxShadow: hover
          ? "0 0 18px rgba(200,120,0,0.15), inset 0 1px 0 rgba(255,200,80,0.08)"
          : "none",
        fontFamily: "'Georgia', serif",
        animation: `fadeSlideUp 0.35s ease ${idx * 0.12}s both`,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "20px",
          color: "rgba(200,120,0,0.5)",
          fontFamily: "monospace",
          fontSize: "11px",
          marginRight: "8px",
        }}
      >
        {idx === 0 ? "I." : "II."}
      </span>
      {choice.label}
      <span
        style={{
          float: "right",
          color: "rgba(180,100,20,0.5)",
          fontSize: "10px",
          fontFamily: "monospace",
          marginTop: "2px",
        }}
      >
        p={choice.probability}
      </span>
    </button>
  );
}

// ─── ROOM VIEW ────────────────────────────────────────────────────────────────
function RoomView({ room, roomIdx, totalRooms, onDecide }) {
  const [phase, setPhase] = useState("evidence"); // evidence | choosing | done
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [evidProg, setEvidProg] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [pendingDecision, setPendingDecision] = useState(null);
  const startRef = useRef(null);
  const timerRef = useRef(null);

  // Evidence accumulation
  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      setEvidProg(Math.min(elapsed / EVIDENCE_DELAY, 1));
      if (elapsed >= EVIDENCE_DELAY) {
        clearInterval(tick);
        setPhase("choosing");
        startRef.current = Date.now();
      }
    }, 50);
    return () => clearInterval(tick);
  }, []);

  // Decision timer
  useEffect(() => {
    if (phase !== "choosing") return;
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, TIME_LIMIT - elapsed);
      setTimeLeft(remaining);
      if (remaining === 0) {
        clearInterval(timerRef.current);
        const randIdx = Math.floor(Math.random() * room.choices.length);
        handleChoice(randIdx, true);
      }
    }, 50);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  const handleChoice = (idx, timedOut = false) => {
    if (phase === "done") return;
    clearInterval(timerRef.current);
    const rt = timedOut ? TIME_LIMIT : Date.now() - startRef.current;
    const choseOptimal = idx === room.optimalIdx;
    setPhase("done");
    const explanation = getDecisionExplanation(room, idx, rt, timedOut);
    const decision = {
      choiceIdx: idx,
      choseOptimal,
      rt,
      timedOut,
      explanation,
    };
    setPendingDecision(decision);
    setFeedback({ idx, choseOptimal, timedOut, rt, explanation });
  };

  const handleNextQuestion = () => {
    if (!pendingDecision) return;
    onDecide(pendingDecision);
  };

  const revealed = phase !== "evidence";

  return (
    <div style={{ animation: "fadeSlideUp 0.4s ease both" }}>
      {/* Room progress */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {Array.from({ length: totalRooms }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: "3px",
              borderRadius: "2px",
              background:
                i < roomIdx
                  ? "rgba(200,120,0,0.7)"
                  : i === roomIdx
                    ? "rgba(240,160,0,0.9)"
                    : "rgba(80,40,10,0.3)",
              boxShadow: i === roomIdx ? "0 0 8px rgba(240,160,0,0.5)" : "none",
              transition: "all 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Icon + Title */}
      <div style={{ textAlign: "center", marginBottom: "16px" }}>
        <div
          style={{
            fontSize: "32px",
            marginBottom: "6px",
            filter: "drop-shadow(0 0 8px rgba(200,120,0,0.4))",
          }}
        >
          {room.icon}
        </div>
        <h2
          style={{
            color: "#e8c98a",
            fontFamily: "'Georgia', serif",
            fontSize: "18px",
            fontWeight: "700",
            letterSpacing: "0.5px",
          }}
        >
          {room.title}
        </h2>
        <div
          style={{
            color: "rgba(180,100,20,0.5)",
            fontSize: "10px",
            fontFamily: "monospace",
            letterSpacing: "2px",
            marginTop: "4px",
          }}
        >
          CHAMBER {roomIdx + 1} OF {totalRooms}
        </div>
      </div>

      {/* Evidence bar */}
      <EvidenceBar progress={evidProg} />

      {/* Scenario */}
      <p
        style={{
          color: "#9e7a50",
          fontSize: "13px",
          lineHeight: "1.75",
          marginBottom: "14px",
          fontFamily: "'Georgia', serif",
          fontStyle: "italic",
        }}
      >
        {room.scenario}
      </p>

      {/* Evidence hint */}
      {(phase === "choosing" || phase === "done") && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "6px",
            background: "rgba(100,50,0,0.25)",
            border: "1px solid rgba(160,80,0,0.3)",
            color: "rgba(220,160,60,0.75)",
            fontSize: "12px",
            fontFamily: "monospace",
            marginBottom: "18px",
            lineHeight: "1.6",
            boxShadow: "inset 0 1px 0 rgba(255,200,80,0.05)",
          }}
        >
          ◈ {room.evidence}
        </div>
      )}

      {/* Timer */}
      {phase === "choosing" && (
        <TimerRing timeLeft={timeLeft} total={TIME_LIMIT} />
      )}

      {/* Choices */}
      <div>
        {room.choices.map((c, i) => (
          <ChoiceButton
            key={i}
            choice={c}
            idx={i}
            onClick={handleChoice}
            revealed={revealed}
            disabled={phase === "done"}
          />
        ))}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          style={{
            marginTop: "14px",
            padding: "12px 16px",
            borderRadius: "8px",
            background: feedback.choseOptimal
              ? "rgba(40,80,20,0.4)"
              : "rgba(80,20,20,0.4)",
            border: `1px solid ${feedback.choseOptimal ? "rgba(100,200,60,0.35)" : "rgba(200,60,60,0.35)"}`,
            animation: "fadeSlideUp 0.3s ease both",
          }}
        >
          <div
            style={{
              color: feedback.choseOptimal ? "#a9e34b" : "#ff6b6b",
              fontSize: "13px",
              fontFamily: "monospace",
              fontWeight: "bold",
              marginBottom: "4px",
            }}
          >
            {feedback.timedOut
              ? "⏱ The darkness chose for you."
              : feedback.choseOptimal
                ? "✦ Optimal path taken."
                : "✗ A costlier road."}
          </div>
          <div
            style={{
              fontSize: "11px",
              fontFamily: "monospace",
              color: "rgba(200,180,140,0.5)",
            }}
          >
            EV optimal: {room.choices[room.optimalIdx].ev.toFixed(1)} gold
            &nbsp;|&nbsp; EV chosen: {room.choices[feedback.idx].ev.toFixed(1)}{" "}
            gold
          </div>
          <div
            style={{
              marginTop: "8px",
              fontSize: "10px",
              lineHeight: "1.6",
              fontFamily: "monospace",
              color: "rgba(220,190,140,0.7)",
            }}
          >
            {feedback.explanation.ddmLine}
          </div>
          <div
            style={{
              marginTop: "6px",
              fontSize: "10px",
              lineHeight: "1.6",
              fontFamily: "monospace",
              color: "rgba(220,190,140,0.7)",
            }}
          >
            {feedback.explanation.boundedLine}
          </div>
          <div
            style={{
              marginTop: "6px",
              fontSize: "10px",
              lineHeight: "1.6",
              fontFamily: "monospace",
              color: "rgba(220,190,140,0.7)",
            }}
          >
            {feedback.explanation.evComparison}
          </div>
          <div
            style={{
              marginTop: "8px",
              fontSize: "10px",
              lineHeight: "1.5",
              fontFamily: "monospace",
              color: "rgba(200,160,110,0.55)",
            }}
          >
            Read the explanation, then continue when ready.
          </div>
          <button
            onClick={handleNextQuestion}
            style={{
              marginTop: "10px",
              width: "100%",
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid rgba(220,170,70,0.45)",
              background: "rgba(120,60,0,0.22)",
              color: "#ffd8a8",
              fontSize: "11px",
              fontFamily: "monospace",
              letterSpacing: "1px",
              cursor: "pointer",
            }}
          >
            NEXT QUESTION ▸
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SCORE SCREEN ─────────────────────────────────────────────────────────────
function ScoreScreen({ decisions }) {
  const v = estimateDriftRate(decisions);
  const a = estimateThreshold(decisions);
  const bayes = computeBayesScore(decisions);
  const res = computeResourceScore(decisions);
  const style = getDecisionStyle(v, a, bayes);
  const correct = decisions.filter((d) => d.choseOptimal).length;
  const avgRT = (
    decisions.reduce((s, d) => s + d.rt, 0) /
    decisions.length /
    1000
  ).toFixed(2);

  const metrics = [
    {
      label: "Drift Rate",
      symbol: "v",
      value: v,
      unit: "",
      color: "#f59f00",
      desc: "Evidence accumulation speed. High v = strong, fast signal processing.",
    },
    {
      label: "Decision Threshold",
      symbol: "a",
      value: a,
      unit: "",
      color: "#748ffc",
      desc: "Caution before committing. High a = deliberate; low a = impulsive.",
    },
    {
      label: "Bayesian Score",
      symbol: "P(H|D)",
      value: bayes,
      unit: "%",
      color: "#cc5de8",
      desc: "Posterior probability you acted as an optimal Bayesian agent.",
    },
    {
      label: "Net Utility",
      symbol: "E[U|π]−λC(π)",
      value: res,
      unit: "g",
      color: "#94d82d",
      desc: "Reward minus cognitive cost (λ=0.3). Resource-rational score.",
    },
  ];

  return (
    <div style={{ animation: "fadeSlideUp 0.5s ease both" }}>
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        <div style={{ fontSize: "28px", marginBottom: "6px" }}>⚔</div>
        <h2
          style={{
            color: "#e8c98a",
            fontFamily: "'Georgia', serif",
            fontSize: "20px",
            marginBottom: "4px",
          }}
        >
          The Reckoning
        </h2>
        <div
          style={{
            color: "rgba(180,100,20,0.5)",
            fontSize: "10px",
            fontFamily: "monospace",
            letterSpacing: "2px",
          }}
        >
          COGNITIVE PROFILE COMPLETE
        </div>
      </div>

      {/* Decision style */}
      <div
        style={{
          textAlign: "center",
          padding: "16px",
          background: "rgba(20,8,2,0.7)",
          border: `1px solid ${style.color}40`,
          borderRadius: "10px",
          marginBottom: "24px",
          boxShadow: `0 0 24px ${style.color}18`,
        }}
      >
        <div
          style={{
            color: "rgba(180,100,20,0.45)",
            fontSize: "10px",
            fontFamily: "monospace",
            letterSpacing: "2px",
            marginBottom: "8px",
          }}
        >
          YOUR ARCHETYPE
        </div>
        <div
          style={{
            color: style.color,
            fontSize: "22px",
            fontFamily: "'Georgia', serif",
            fontWeight: "bold",
            marginBottom: "8px",
            textShadow: `0 0 20px ${style.color}60`,
          }}
        >
          {style.label}
        </div>
        <div
          style={{
            color: "#9e7a50",
            fontSize: "12px",
            fontFamily: "'Georgia', serif",
            fontStyle: "italic",
            lineHeight: "1.6",
          }}
        >
          {style.desc}
        </div>
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            justifyContent: "center",
            gap: "24px",
            fontSize: "11px",
            fontFamily: "monospace",
            color: "rgba(180,120,40,0.5)",
          }}
        >
          <span>
            {correct}/{decisions.length} optimal
          </span>
          <span>avg {avgRT}s</span>
        </div>
      </div>

      {/* Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
        {metrics.map((m) => (
          <div
            key={m.label}
            style={{
              padding: "14px",
              borderRadius: "8px",
              background: "rgba(15,7,2,0.6)",
              border: `1px solid ${m.color}25`,
              boxShadow: `0 0 12px ${m.color}0a`,
            }}
          >
            <div
              style={{
                color: "rgba(180,100,20,0.4)",
                fontSize: "9px",
                fontFamily: "monospace",
                letterSpacing: "1.5px",
                marginBottom: "6px",
              }}
            >
              {m.label.toUpperCase()}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "4px",
                marginBottom: "4px",
              }}
            >
              <span
                style={{
                  color: m.color,
                  fontSize: "22px",
                  fontWeight: "bold",
                  fontFamily: "'Georgia', serif",
                }}
              >
                {m.value}
              </span>
              <span
                style={{
                  color: `${m.color}80`,
                  fontSize: "11px",
                  fontFamily: "monospace",
                }}
              >
                {m.unit}
              </span>
            </div>
            <div
              style={{
                color: "rgba(180,120,40,0.35)",
                fontSize: "10px",
                fontFamily: "monospace",
                lineHeight: "1.5",
              }}
            >
              {m.symbol}
            </div>
            <p
              style={{
                color: "rgba(160,110,50,0.45)",
                fontSize: "10px",
                fontFamily: "monospace",
                margin: "4px 0 0",
                lineHeight: "1.5",
              }}
            >
              {m.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Decision log */}
      <div>
        <div
          style={{
            color: "rgba(180,100,20,0.4)",
            fontSize: "9px",
            fontFamily: "monospace",
            letterSpacing: "2px",
            marginBottom: "8px",
          }}
        >
          SCROLL OF DECISIONS
        </div>
        {decisions.map((d, i) => {
          const chosen = ROOMS[i].choices[d.choiceIdx];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: "6px",
                background:
                  i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
                marginBottom: "2px",
              }}
            >
              <span
                style={{
                  color: "rgba(160,110,50,0.55)",
                  fontSize: "11px",
                  fontFamily: "'Georgia', serif",
                  flex: 1,
                }}
              >
                {ROOMS[i].title}
              </span>
              <span
                style={{
                  display: "flex",
                  gap: "12px",
                  fontFamily: "monospace",
                  fontSize: "10px",
                }}
              >
                <span style={{ color: "rgba(160,110,50,0.35)" }}>
                  ev={chosen.ev.toFixed(1)}
                </span>
                <span style={{ color: "rgba(160,110,50,0.35)" }}>
                  {(d.rt / 1000).toFixed(2)}s
                </span>
                <span
                  style={{
                    color: d.choseOptimal ? "#a9e34b" : "#e03131",
                    fontWeight: "bold",
                    minWidth: "10px",
                    textAlign: "center",
                  }}
                >
                  {d.choseOptimal ? "✦" : "✗"}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {/* End recap */}
      <div style={{ marginTop: "22px" }}>
        <div
          style={{
            color: "rgba(180,100,20,0.4)",
            fontSize: "9px",
            fontFamily: "monospace",
            letterSpacing: "2px",
            marginBottom: "8px",
          }}
        >
          ROOM-BY-ROOM RECAP
        </div>
        {decisions.map((d, i) => {
          const explanation =
            d.explanation ||
            getDecisionExplanation(ROOMS[i], d.choiceIdx, d.rt, d.timedOut);
          return (
            <div
              key={`recap-${i}`}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                marginBottom: "8px",
                background: "rgba(20,10,5,0.45)",
                border: "1px solid rgba(120,60,0,0.2)",
              }}
            >
              <div
                style={{
                  color: "rgba(220,170,90,0.7)",
                  fontSize: "10px",
                  fontFamily: "monospace",
                  marginBottom: "4px",
                }}
              >
                {`CHAMBER ${i + 1}: ${ROOMS[i].title}`}
              </div>
              <div
                style={{
                  color: "rgba(220,190,140,0.72)",
                  fontSize: "10px",
                  lineHeight: "1.6",
                  fontFamily: "monospace",
                }}
              >
                {explanation.ddmLine}
              </div>
              <div
                style={{
                  marginTop: "4px",
                  color: "rgba(220,190,140,0.72)",
                  fontSize: "10px",
                  lineHeight: "1.6",
                  fontFamily: "monospace",
                }}
              >
                {explanation.boundedLine}
              </div>
              <div
                style={{
                  marginTop: "4px",
                  color: "rgba(220,190,140,0.72)",
                  fontSize: "10px",
                  lineHeight: "1.6",
                  fontFamily: "monospace",
                }}
              >
                {explanation.evComparison}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function DDMDungeon() {
  const [phase, setPhase] = useState("intro");
  const [roomIdx, setRoomIdx] = useState(0);
  const [decisions, setDecisions] = useState([]);

  const handleDecide = useCallback(
    (decision) => {
      const next = [...decisions, decision];
      setDecisions(next);
      if (roomIdx + 1 >= ROOMS.length) {
        setTimeout(() => setPhase("score"), 250);
      } else {
        setTimeout(() => setRoomIdx((i) => i + 1), 250);
      }
    },
    [decisions, roomIdx],
  );

  const restart = () => {
    setPhase("intro");
    setRoomIdx(0);
    setDecisions([]);
  };

  // Shared container style
  const containerStyle = {
    width: "100%",
    minHeight: "100vh",
    padding: "32px",
  };

  return (
    <>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes flicker {
          0%, 100% { opacity: 0.85; } 45% { opacity: 0.7; } 50% { opacity: 0.9; } 55% { opacity: 0.75; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; } 50% { opacity: 0.75; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0402; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(120,60,0,0.3); border-radius: 2px; }
      `}</style>

      <div
        style={{
          minHeight: "100vh",
          background: [
            "radial-gradient(ellipse at 30% 10%, rgba(100,40,0,0.2) 0%, transparent 55%)",
            "radial-gradient(ellipse at 70% 90%, rgba(60,20,0,0.25) 0%, transparent 50%)",
            "radial-gradient(ellipse at 50% 50%, rgba(30,8,0,0.5) 0%, transparent 70%)",
            "#0a0402",
          ].join(", "),
          fontFamily: "'Georgia', serif",
        }}
      >
        <div style={containerStyle}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "26px",
              paddingBottom: "14px",
              borderBottom: "1px solid rgba(120,60,0,0.25)",
            }}
          >
            <span
              style={{
                color: "rgba(200,120,30,0.7)",
                fontSize: "11px",
                fontFamily: "monospace",
                letterSpacing: "3px",
                animation: "flicker 4s infinite",
              }}
            >
              ⚔ THE DECISION DUNGEON
            </span>
            <span
              style={{
                color: "rgba(160,80,20,0.4)",
                fontSize: "10px",
                fontFamily: "monospace",
                animation: "pulse 3s infinite",
              }}
            >
              COGS 180 ▸ W26
            </span>
          </div>

          {/* INTRO */}
          {phase === "intro" && (
            <div style={{ animation: "fadeSlideUp 0.5s ease both" }}>
              <h1
                style={{
                  fontSize: "30px",
                  fontWeight: "800",
                  color: "#e8c98a",
                  fontFamily: "'Georgia', serif",
                  marginBottom: "6px",
                  letterSpacing: "-0.5px",
                  textShadow: "0 0 30px rgba(200,120,0,0.3)",
                }}
              >
                The Decision
                <br />
                Dungeon
              </h1>
              <p
                style={{
                  color: "rgba(160,90,20,0.6)",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  marginBottom: "22px",
                  lineHeight: "1.8",
                  letterSpacing: "0.5px",
                }}
              >
                {ROOMS.length} chambers. Binary fates. Shadows watching.
                <br />
                Your choices will be judged by three ancient laws:
                <br />
                — Drift Diffusion Model (v, a)
                <br />
                — Bayesian Decision Theory P(H|D)
                <br />— Resource Rationality E[U|π] − λC(π)
              </p>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: "rgba(60,25,0,0.35)",
                  border: "1px solid rgba(120,60,0,0.3)",
                  color: "rgba(200,130,40,0.6)",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  marginBottom: "28px",
                  lineHeight: "1.7",
                }}
              >
                ◈ Each chamber grants {(EVIDENCE_DELAY / 1000).toFixed(1)}s of
                observation,
                <br />
                then {(TIME_LIMIT / 1000).toFixed(0)}s to decide. Hesitate too
                long — the dungeon chooses.
              </div>
              <button
                onClick={() => setPhase("game")}
                style={{
                  width: "100%",
                  padding: "16px",
                  background:
                    "linear-gradient(135deg, rgba(160,70,0,0.25), rgba(100,40,0,0.15))",
                  border: "1px solid rgba(200,100,20,0.45)",
                  borderRadius: "10px",
                  color: "#f59f00",
                  fontSize: "13px",
                  fontFamily: "monospace",
                  letterSpacing: "3px",
                  cursor: "pointer",
                  boxShadow: "0 0 20px rgba(160,80,0,0.12)",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 0 35px rgba(200,100,0,0.25)";
                  e.currentTarget.style.borderColor = "rgba(240,160,0,0.65)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 0 20px rgba(160,80,0,0.12)";
                  e.currentTarget.style.borderColor = "rgba(200,100,20,0.45)";
                }}
              >
                DESCEND INTO DARKNESS ▸
              </button>
            </div>
          )}

          {/* GAME */}
          {phase === "game" && (
            <RoomView
              key={roomIdx}
              room={ROOMS[roomIdx]}
              roomIdx={roomIdx}
              totalRooms={ROOMS.length}
              onDecide={handleDecide}
            />
          )}

          {/* SCORE */}
          {phase === "score" && (
            <>
              <ScoreScreen decisions={decisions} />
              <button
                onClick={restart}
                style={{
                  width: "100%",
                  marginTop: "24px",
                  padding: "13px",
                  background: "transparent",
                  border: "1px solid rgba(100,50,10,0.3)",
                  borderRadius: "8px",
                  color: "rgba(160,100,30,0.4)",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  letterSpacing: "2px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(200,100,20,0.4)";
                  e.currentTarget.style.color = "rgba(200,120,40,0.65)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(100,50,10,0.3)";
                  e.currentTarget.style.color = "rgba(160,100,30,0.4)";
                }}
              >
                ↺ DESCEND AGAIN
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

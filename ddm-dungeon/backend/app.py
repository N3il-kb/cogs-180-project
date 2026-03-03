# Backend for DDM Dungeon — serves room data and explanations grounded in
# Drift-Diffusion Model, Expected Utility Theory, Bayesian Decision Theory,
# and Resource Rationality.

import math
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
app = Flask(__name__)
CORS(app)

# ─── DDM Simulation ────────────────────────────────────────────────────────────
def simulate_ddm(v, z, a, t0, sigma, num_trials=2000, max_steps=5000, seed=42):
    """
    Simulate a Drift-Diffusion Model.
    - v: drift rate (evidence strength / direction)
    - z: starting-point bias (0-1, relative to threshold a)
    - a: decision threshold (boundary height)
    - t0: non-decision time (encoding + motor)
    - sigma: noise in evidence accumulation
    Returns mean RT, choice probabilities.
    """
    rng = np.random.default_rng(seed)
    rts = []
    choices = []
    for _ in range(num_trials):
        x = z * a
        t = 0
        while 0 < x < a and t < max_steps:
            x += v + sigma * rng.standard_normal()
            t += 1
        rts.append(t + t0)
        choices.append(1 if x >= a else 0)
    rts = np.array(rts)
    choices = np.array(choices)
    return {
        "mean_rt": float(np.mean(rts)),
        "std_rt": float(np.std(rts)),
        "p_upper": float(np.mean(choices)),
        "p_lower": float(1 - np.mean(choices)),
    }


# ─── EUT Computation ───────────────────────────────────────────────────────────
def utility(x, rho=1.0):
    """Power utility: u(x) = x^rho for x >= 0."""
    return max(0, x) ** rho


def expected_utility(value, probability, rho=1.0):
    """EU = p * u(value)."""
    return probability * utility(value, rho)


# ─── Room Data + Explanations ──────────────────────────────────────────────────
ROOMS = [
    {
        "id": 1,
        "title": "The Merchant's Offer",
        "icon": "⚖",
        "scenario": (
            "A cloaked merchant materializes from the shadows. He spreads two "
            "contracts upon a crumbling altar, his eyes gleaming with something ancient."
        ),
        "choices": [
            {"label": "Accept the sealed pouch — 10 gold coins, guaranteed.",
             "value": 10, "probability": 1.0, "ev": 10},
            {"label": "Gamble on the jeweled box — 25 gold, but cursed 40% of the time.",
             "value": 25, "probability": 0.6, "ev": 15},
        ],
        "optimalIdx": 1,
        "evidence": "You notice fresh scratches on the iron lock — the box has been opened recently. Others survived.",
        "drift_signal": 0.6,
        "ddm_params": {"v": 0.15, "z": 0.5, "a": 2.0, "t0": 20, "sigma": 0.5},
        "concept_focus": "expected_value",
    },
    {
        "id": 2,
        "title": "The Cursed Chest",
        "icon": "⚰",
        "scenario": (
            "Two chests rest on a stone dais slick with old blood. Ancient runes "
            "carve themselves slowly into the walls around you. Your torch gutters."
        ),
        "choices": [
            {"label": "Pry open the iron chest — certain 5 gold, no risk.",
             "value": 5, "probability": 1.0, "ev": 5},
            {"label": "Break the ornate seal — 80% chance of 8 gold inside.",
             "value": 8, "probability": 0.8, "ev": 6.4},
        ],
        "optimalIdx": 1,
        "evidence": "The ornate chest's runes pulse with a steady rhythm — a warding sign, not a curse.",
        "drift_signal": 0.7,
        "ddm_params": {"v": 0.08, "z": 0.5, "a": 2.5, "t0": 25, "sigma": 0.4},
        "concept_focus": "risk_aversion",
    },
    {
        "id": 3,
        "title": "The Fork in the Path",
        "icon": "⛧",
        "scenario": (
            "Two tunnels cleave the darkness ahead. Scouts who ventured both returned "
            "— but one lost two fingers. You must choose before the torchlight dies."
        ),
        "choices": [
            {"label": "Left passage — 30% ambush risk, reward of 20 gold.",
             "value": 20, "probability": 0.7, "ev": 14},
            {"label": "Right passage — 10% ambush risk, reward of 12 gold.",
             "value": 12, "probability": 0.9, "ev": 10.8},
        ],
        "optimalIdx": 0,
        "evidence": "Fresh boot-prints lead left. The scout who lost fingers went right.",
        "drift_signal": 0.4,
        "ddm_params": {"v": 0.12, "z": 0.45, "a": 1.8, "t0": 15, "sigma": 0.6},
        "concept_focus": "bayesian_updating",
    },
    {
        "id": 4,
        "title": "The Dragon's Demand",
        "icon": "🐉",
        "scenario": (
            "A young wyvern coils around the passage ahead, scales still soft. "
            "It bares its teeth — either you pay tribute, or you gamble on steel."
        ),
        "choices": [
            {"label": "Offer tribute — lose 8 gold, pass unharmed.",
             "value": -8, "probability": 1.0, "ev": -8},
            {"label": "Draw your blade — 40% to win 15 gold, 60% to flee losing only 3.",
             "value": 15, "probability": 0.4, "ev": 0.6},
        ],
        "optimalIdx": 1,
        "evidence": "The wyvern's wing is scarred — it has fled before. It may again.",
        "drift_signal": 0.3,
        "ddm_params": {"v": 0.05, "z": 0.6, "a": 3.0, "t0": 30, "sigma": 0.7},
        "concept_focus": "loss_aversion",
    },
    {
        "id": 5,
        "title": "The Final Gate",
        "icon": "🗝",
        "scenario": (
            "The dungeon's last threshold stands before you. The gatekeeper — a "
            "skeletal figure in iron robes — extends both hands. One key, one exit, one chance."
        ),
        "choices": [
            {"label": "Take the golden key — 95% opens the gate, 30 gold reward.",
             "value": 30, "probability": 0.95, "ev": 28.5},
            {"label": "Seize the silver key — 50% opens the gate, 50 gold reward.",
             "value": 50, "probability": 0.5, "ev": 25},
        ],
        "optimalIdx": 0,
        "evidence": "The golden key is warm — enchanted. The silver key smells of failure.",
        "drift_signal": 0.8,
        "ddm_params": {"v": 0.20, "z": 0.5, "a": 2.0, "t0": 20, "sigma": 0.4},
        "concept_focus": "resource_rationality",
    },
]


def build_explanation(room, user_choice_idx, rt_ms):
    """
    Build a rich explanation grounded in DDM, EUT, BDT, and Resource Rationality.
    """
    chosen = room["choices"][user_choice_idx]
    optimal = room["choices"][room["optimalIdx"]]
    is_correct = user_choice_idx == room["optimalIdx"]
    concept = room["concept_focus"]
    ddm = room["ddm_params"]

    # Run DDM simulation for this room
    ddm_result = simulate_ddm(**ddm)

    # Compute EU for both choices (rho=1 is risk-neutral)
    eu_a = expected_utility(room["choices"][0]["value"], room["choices"][0]["probability"])
    eu_b = expected_utility(room["choices"][1]["value"], room["choices"][1]["probability"])

    sections = []

    # 1) Verdict
    if is_correct:
        sections.append({
            "type": "verdict",
            "title": "✦ Optimal Path Taken",
            "text": (
                f"You chose wisely. The option you selected has an expected value of "
                f"{chosen['ev']:.1f} gold, which is the higher EV in this scenario."
            ),
        })
    else:
        sections.append({
            "type": "verdict",
            "title": "✗ A Costlier Road",
            "text": (
                f"The optimal choice had an expected value of {optimal['ev']:.1f} gold, "
                f"but you chose the option worth {chosen['ev']:.1f} gold in expectation — "
                f"a difference of {abs(optimal['ev'] - chosen['ev']):.1f} gold."
            ),
        })

    # 2) EUT explanation
    eut_text = (
        f"Expected Utility Theory (EUT) evaluates each option as EU = p × u(x). "
        f"Here, Option I has EU = {room['choices'][0]['probability']} × u({room['choices'][0]['value']}) = {eu_a:.1f}, "
        f"and Option II has EU = {room['choices'][1]['probability']} × u({room['choices'][1]['value']}) = {eu_b:.1f}. "
    )
    if concept == "risk_aversion":
        eut_text += (
            "Many people prefer the certain option even when the gamble has higher EV — "
            "this is risk aversion. In EUT, a concave utility function (ρ < 1) "
            "makes safe options more attractive: u(x) = x^ρ shrinks the value "
            "of large but uncertain rewards."
        )
    elif concept == "loss_aversion":
        eut_text += (
            "When losses are involved, loss aversion (overweighting losses relative to "
            "gains) can push you toward costly sure outcomes. EUT with a standard utility "
            "function says to compare expected values, and the gamble here has a positive "
            "expected outcome versus a guaranteed loss."
        )
    elif concept == "expected_value":
        eut_text += (
            "A risk-neutral agent (ρ = 1) simply picks the option with the highest "
            "expected value. The gamble's EV of 15.0 exceeds the sure 10.0, making it "
            "the rational choice — assuming you can tolerate the variance."
        )
    else:
        eut_text += (
            "A rational agent maximizes expected utility: choosing the option whose "
            "probability-weighted value is highest."
        )

    sections.append({
        "type": "eut",
        "title": "📊 Expected Utility Theory",
        "text": eut_text,
    })

    # 3) DDM explanation
    rt_seconds = rt_ms / 1000.0
    ddm_text = (
        f"The Drift-Diffusion Model (DDM) explains how you arrived at this decision. "
        f"Evidence accumulates as x ← x + v + σε at each time step until hitting a bound. "
        f"Here, the drift rate v = {ddm['v']:.2f} represents evidence strength toward "
        f"the optimal choice. Your reaction time was {rt_seconds:.2f}s. "
    )
    if rt_seconds < 2.0:
        ddm_text += (
            "That's a fast response — in DDM terms, you used a low effective decision "
            f"threshold. The model threshold is a = {ddm['a']:.1f}. "
            "Low thresholds mean faster but potentially less accurate decisions "
            "(the speed-accuracy tradeoff). "
        )
    elif rt_seconds > 5.0:
        ddm_text += (
            "You took your time — this suggests a high effective decision threshold. "
            f"The model threshold is a = {ddm['a']:.1f}. "
            "Higher thresholds mean slower but more deliberate choices. "
            f"Starting-point bias z = {ddm['z']:.2f} means "
            + ("a slight lean toward Option I." if ddm["z"] < 0.5 else
               "a slight lean toward Option II." if ddm["z"] > 0.5 else
               "no initial bias.")
            + " "
        )
    else:
        ddm_text += (
            f"The model threshold is a = {ddm['a']:.1f} and noise σ = {ddm['sigma']:.1f}. "
            "The decision is made when accumulated evidence hits either the upper bound "
            "(Option II) or lower bound (Option I). "
        )

    ddm_text += (
        f"Simulating this DDM ({ddm_result['mean_rt']:.0f} avg steps), "
        f"the model predicts choosing Option II with P = {ddm_result['p_upper']:.2f}."
    )

    sections.append({
        "type": "ddm",
        "title": "🧠 Drift-Diffusion Model",
        "text": ddm_text,
    })

    # 4) Bayesian explanation
    signal = room["drift_signal"]
    if concept == "bayesian_updating":
        bayes_text = (
            "This chamber highlights Bayesian updating. The dungeon clue acts as a "
            "likelihood signal that shifts your prior belief about which path is safer. "
            "In Bayesian Decision Theory, your posterior P(safe | evidence) is a "
            "precision-weighted combination of prior and evidence: "
            "μ_post = σ²_post × (μ₀/σ₀² + μ_L/σ_L²). "
            "The clue that the left path had fresh boot-prints (others survived) "
            "is high-precision evidence favoring the left path."
        )
    else:
        bayes_text = (
            f"The dungeon clue acts as Bayesian evidence with signal strength {signal:.1f}. "
            f"The log-likelihood ratio for the optimal choice is "
            f"log(s/(1−s)) = {math.log(signal / (1 - signal)):.2f}. "
        )
        if signal > 0.6:
            bayes_text += (
                "This is moderately strong evidence — a Bayesian agent would shift "
                "noticeably toward the optimal choice after seeing this clue."
            )
        else:
            bayes_text += (
                "This is relatively weak evidence — even a Bayesian agent might remain "
                "uncertain, making this a genuinely hard decision."
            )

    sections.append({
        "type": "bayesian",
        "title": "📐 Bayesian Evidence",
        "text": bayes_text,
    })

    # 5) Resource Rationality
    rr_text = (
        "Resource Rationality says optimal behavior balances decision quality against "
        "thinking cost: max_π E[U | π] − λ·C(π). "
    )
    if concept == "resource_rationality":
        rr_text += (
            "In this final chamber, the golden key (EV = 28.5) and silver key (EV = 25) "
            "are close in value. A resource-rational agent recognizes that extra "
            "cognitive effort to distinguish them may not be worth the cost. "
            "The high signal strength (0.8) reduces the effort needed — like increasing "
            "incentive I, which lowers λ_eff and makes thinking more worthwhile. "
            "Under time pressure, cognitive cost C rises (C = κ·exp(η_P·P)), "
            "pushing optimal cognitive investment κ* down — noisier but faster decisions."
        )
    else:
        rr_text += (
            f"Your RT of {rt_seconds:.2f}s reflects cognitive investment (κ). "
            "More time = more precise value estimates (σ_i ∝ 1/√κ), but at greater cost. "
        )
        if rt_seconds < 2.0:
            rr_text += (
                "Your quick decision suggests low κ — you relied on heuristics. "
                "Under time pressure, this can be resource-rational."
            )
        elif rt_seconds > 5.0:
            rr_text += (
                "Your deliberate pace suggests high κ — heavy investment in precision. "
                "This is rational when stakes are high and time permits."
            )
        else:
            rr_text += (
                "Your moderate pace suggests balanced cognitive investment — "
                "enough effort for a reasonable estimate without overinvesting."
            )

    sections.append({
        "type": "resource_rationality",
        "title": "⚡ Resource Rationality",
        "text": rr_text,
    })

    return sections


# ─── API Endpoints ──────────────────────────────────────────────────────────────

@app.route("/api/rooms", methods=["GET"])
def get_rooms():
    """Return all room data for the frontend."""
    public_rooms = []
    for r in ROOMS:
        public_rooms.append({
            "id": r["id"],
            "title": r["title"],
            "icon": r["icon"],
            "scenario": r["scenario"],
            "choices": r["choices"],
            "optimalIdx": r["optimalIdx"],
            "evidence": r["evidence"],
            "drift_signal": r["drift_signal"],
        })
    return jsonify(public_rooms)


@app.route("/api/explain", methods=["POST"])
def explain():
    """
    Given a room ID, the user's choice index, and their RT,
    return a structured explanation grounded in DDM/EUT/BDT/RR.
    """
    data = request.json
    room_id = data.get("roomId")
    user_choice = data.get("choiceIdx")
    rt_ms = data.get("rt", 4000)

    room = next((r for r in ROOMS if r["id"] == room_id), None)
    if room is None:
        return jsonify({"error": "Room not found"}), 404

    sections = build_explanation(room, user_choice, rt_ms)
    return jsonify({"sections": sections})


if __name__ == "__main__":
    app.run(debug=True, port=5001)

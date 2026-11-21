"""Read the two public, server-rendered Frontier Design Benchmark scoreboards."""
from html.parser import HTMLParser
import re

BASE = "https://contralabs.com/frontierdesign/"


class Scoreboard(HTMLParser):
    """Keep only fields inside leaderboard list items or rubric tooltips."""

    def __init__(self):
        super().__init__()
        self.rows = []
        self.nodes = []
        self.fields = None
        self.expected = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set(attrs.get("class", "").split())
        match = re.search(r"Elo rating [^,]+, \d+\w+ of (\d+)", attrs.get("aria-label", ""))
        if match:
            self.expected = int(match[1])
        if not self.nodes:
            if not (tag == "li" and "bar" in classes or tag == "div" and "vtip" in classes):
                return
            self.fields = {}
        if tag in {"img", "input", "br", "hr", "source", "wbr"}:
            return
        field = next((name for name in ("bar__rank", "bar__label", "bar__val", "bar__sub", "vtip__name", "vtip__dim") if name in classes), None)
        if tag == "small" and self.nodes and self.nodes[-1][1] == "bar__label":
            field = "developer"
        if field:
            self.fields.setdefault(field, []).append("")
        self.nodes.append((tag, field))

    def handle_endtag(self, tag):
        if self.nodes and self.nodes[-1][0] == tag:
            self.nodes.pop()
            if not self.nodes:
                self.rows.append(self.fields)
                self.fields = None

    def handle_data(self, data):
        if self.nodes and self.nodes[-1][1]:
            self.fields[self.nodes[-1][1]][-1] += data


def normalized(label):
    return re.sub(r"\s*\(stealth\)$", "", label.strip(), flags=re.I).casefold()


def parse_contra(leaderboard, rubric):
    board, criteria = Scoreboard(), Scoreboard()
    board.feed(leaderboard)
    criteria.feed(rubric)
    critiques = {}
    for row in criteria.rows:
        value = next((re.fullmatch(r"\s*CRITIQUE\s+(\d+(?:\.\d+)?)\s*", text) for text in row.get("vtip__dim", []) if "CRITIQUE" in text), None)
        if value:
            critiques[normalized(row["vtip__name"][0])] = float(value[1])

    result, ranks = [], []
    for row in board.rows:
        if "bar__rank" not in row:
            continue
        name = row["bar__label"][0].strip()
        developer, elo = re.fullmatch(r"(.+?)\s*·\s*Elo\s+([\d,]+)", row["developer"][0].strip(), re.I).groups()
        rank = int(row["bar__rank"][0])
        ranks.append(rank)
        if normalized(name) == "human designers":
            continue
        low, high = re.fullmatch(r"(\d+)\s*[–—-]\s*(\d+)", row["bar__sub"][0].strip()).groups()
        wins = int(row["bar__val"][0].strip().rstrip("%"))
        if not 0 <= int(low) <= wins <= int(high) <= 100:
            raise ValueError("Invalid win-rate interval for " + name)
        result.append({
            "name": name, "org": developer.strip(), "source_label": name, "rank": rank,
            "elo": int(elo.replace(",", "")), "win_rate": wins / 100,
            "win_lo": int(low) / 100, "win_hi": int(high) / 100,
            "votes": int(row["bar__sub"][1].strip().replace(",", "")),
            "rubric": critiques.get(normalized(name)),
        })
    if not board.expected or ranks != list(range(1, board.expected + 1)) or not result or not any(m["rubric"] is not None for m in result):
        raise ValueError("Frontier Design Benchmark scoreboard is incomplete")
    if len({normalized(m["name"]) for m in result}) != len(result):
        raise ValueError("Duplicate participant in Frontier Design Benchmark")
    return {"models": result, "source": BASE+"leaderboard", "rubric_source": BASE+"rubric"}


def fetch_contra(http_get):
    return parse_contra(http_get(BASE+"leaderboard").decode(), http_get(BASE+"rubric").decode())

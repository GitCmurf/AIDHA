"""Check the repository's analysis contract against DeepSource's public TOML schema."""

from pathlib import Path
import tomllib
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class TestDeepSourceConfig(unittest.TestCase):
    def test_javascript_analysis_supports_node_esm_typescript_without_exclusions(self):
        # The supported keys and values come from the external analyzer contract:
        # https://docs.deepsource.com/docs/platform/reference/core-analyzers#javascript
        with (REPO_ROOT / ".deepsource.toml").open("rb") as config_file:
            config = tomllib.load(config_file)

        self.assertEqual(config["version"], 1)
        self.assertFalse(config.get("exclude_patterns"), "Do not exclude source files")
        javascript = [entry for entry in config["analyzers"] if entry["name"] == "javascript"]
        self.assertEqual(len(javascript), 1, "Keep one unambiguous JavaScript analyzer")
        analyzer = javascript[0]
        self.assertIs(analyzer.get("enabled", True), True, "Analysis must remain enabled")
        supported_analyzer_keys = {"name", "enabled", "dependency_file_paths", "meta"}
        self.assertFalse(
            set(analyzer) - supported_analyzer_keys,
            "Analyzer-specific options belong inside analyzers.meta",
        )

        meta = analyzer["meta"]
        self.assertIsInstance(meta["environment"], list)
        self.assertEqual(set(meta["environment"]), {"nodejs"})
        self.assertEqual(meta["module_system"], "es-modules")
        self.assertEqual(meta["dialect"], "typescript")
        framework_plugins = {"react", "vue", "ember", "meteor", "angular", "angularjs"}
        plugins = meta.get("plugins", [])
        self.assertIsInstance(plugins, list)
        self.assertTrue(set(plugins) <= framework_plugins, "TypeScript is a dialect, not a framework")


if __name__ == "__main__":
    unittest.main()

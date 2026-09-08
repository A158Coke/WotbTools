import unittest

import blitzkit_snapshot
import update_tankopedia


class TankopediaSourceConsistencyTest(unittest.TestCase):
    def test_all_tankopedia_definitions_use_production_api(self):
        base = "https://api.blitzkit.app"
        self.assertEqual(base, blitzkit_snapshot.BLITZKIT_API_BASE)
        self.assertEqual(f"{base}/definitions/game.pb", blitzkit_snapshot.GAME_URL)
        self.assertEqual(f"{base}/definitions/tanks.pb", update_tankopedia.PB_URL)
        self.assertEqual(
            f"{base}/definitions/consumables.pb",
            update_tankopedia.CONSUMABLES_URL,
        )
        self.assertEqual(
            f"{base}/definitions/provisions.pb",
            update_tankopedia.PROVISIONS_URL,
        )
        self.assertEqual(
            f"{base}/definitions/equipment.pb",
            update_tankopedia.EQUIPMENT_URL,
        )


if __name__ == "__main__":
    unittest.main()

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from "./src/lib/prisma.js";
import bcrypt from 'bcrypt';
import { analyze } from './src/engine/stockfish.js';
const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", async (req, res) => {
    try {
        return res.status(200).json({ "msg": "Server is working" });
    }
    catch (error) {
        return res.status(505).json({ "msg": "Internal Server Error", error });
    }
});
//signin
//name , email , password 
app.post("/signin", async (req, res) => {
    const { email, name, password } = req.body;
    try {
        const response = await prisma.user.findFirst({
            where: { email }
        });
        if (response) {
            //signin
            const checkPassword = await bcrypt.compare(password, response.password);
            if (checkPassword) {
                return res.status(200).json({ "id": response.id, "email": response.email, "name": response.name, "msg": "You have successfully signed in" });
            }
            else {
                return res.status(401).json({ "msg": "Password was incorrect" });
            }
        }
        else {
            //signup 
            const hashedPassword = await bcrypt.hash(password, 12);
            const userResponse = await prisma.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword
                }
            });
            return res.status(200).json({ "id": userResponse.id, "email": userResponse.email, "name": userResponse.name, "msg": "You have successfully signed up" });
        }
    }
    catch (error) {
        return res.status(505).json({ "msg": "Internal Server Error", error });
    }
});
// fen: full FEN of the current position.
// skillLevel (0-20, optional): difficulty knob. depth (optional): search depth.
app.post("/ai-move", async (req, res) => {
    const { fen, depth, skillLevel } = req.body;
    if (!fen || typeof fen !== 'string') {
        return res.status(400).json({ "msg": "A FEN string for the current position is required" });
    }
    const depthNum = Number(depth) || 12;
    const skillNum = skillLevel === undefined ? 8 : Number(skillLevel);
    try {
        const result = await analyze(fen, skillNum, depthNum);
        return res.status(200).json({
            "success": true,
            "bestmove": result.bestmove, // UCI, "" if the position is terminal
            "ponder": result.ponder,
            "evaluation": result.evaluation,
            "mate": result.mate,
            "gameOver": result.bestmove === ""
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ "success": false, "msg": "Engine failed to produce a move", "error": message });
    }
});
app.listen(3004, () => console.log("backend listening on :3004"));
//# sourceMappingURL=index.js.map
import { Response } from "express";
import { redis } from "../utils/redis";

//get user by id
export const getUserById = async (res: Response, id: string) => {
    const userJson = await redis.get(id);

    if (userJson) {
        const user = JSON.parse(userJson);
        res.status(201).json({
            success: true,
            user,
        });
    }
}; 
import dotenv from "dotenv";
dotenv.config();
import { Request, Response, NextFunction } from "express";
import userModel, { IUser } from "../models/user_model";
import ErrorHandler from "../utils/ErrorHandler";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import jwt, { JwtPayload, Secret } from "jsonwebtoken";
import ejs from "ejs";
import path from "path";
import { sendMail } from "../utils/sendEmail";
import { accessTokenOptions, refreshTokenOptions, sendToken } from "../utils/jwt";
import { redis } from "../utils/redis";
import { getUserById } from "../services/user.services";
import cloudinary from "cloudinary";

//register user
interface IRegistrationBody {
    name: string;
    email: string;
    password: string;
    avatar?: string;
};

export const registrationUser = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { name, email, password } = req.body;

        const emailExist = await userModel.findOne({ email });
        if (emailExist) {
            return next(new ErrorHandler("Email already exist", 400));
        };
        const user: IRegistrationBody = {
            name, email, password,
        };
        const activateToken = createActivationToken(user);
        const activationCode = activateToken.activationCode;
        const data = { user: { name: user.name }, activationCode };
        const html = await ejs.renderFile(path.join(__dirname, "../mails/activation-mail.ejs"), data);

        try {
            await sendMail({
                email: user.email,
                subject: "Activate your account",
                template: "activation-mail.ejs",
                data,
            });

            res.status(201).json({
                success: true,
                message: `Please check your email: ${user.email} to activate your account!`,
                activateToken: activateToken.token,
            });
        } catch (error: any) {
            return next(new ErrorHandler(error.message, 400));
        }
    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
});

interface ActivationToken {
    token: string;
    activationCode: string;
}

export const createActivationToken = (user: any): ActivationToken => {
    const activationCode = Math.floor(1000 + Math.random() * 9000).toString();

    const token = jwt.sign({
        user, activationCode
    }, process.env.ACTIVATION_SECRET as Secret,
        {
            expiresIn: "5m",
        });

    return { token, activationCode };
};

//activate user
interface ActivationRequest {
    activation_token: string;
    activation_code: string;
}

export const activateUser = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { activation_token, activation_code } = req.body as ActivationRequest;

        const newUser: { user: IUser; activationCode: string } = jwt.verify(
            activation_token,
            process.env.ACTIVATION_SECRET as string
        ) as { user: IUser; activationCode: string };

        if (newUser.activationCode !== activation_code) {
            return next(new ErrorHandler("Invalid activation code", 400));
        }

        const { name, email, password } = newUser.user;

        const existUser = await userModel.findOne({ email });

        if (existUser) {
            return next(new ErrorHandler("Email already exist", 400));
        }
        const user = await userModel.create({
            name, email, password,
        });

        res.status(201).json({
            success: true,
            message: "User activated successfully.",
        });
    }
    catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
});

//login user
interface LoginRequest {
    email: string;
    password: string;
}

export const loginUser = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = req.body as LoginRequest;

        if (!email || !password) {
            return next(new ErrorHandler("Please enter email and password", 400));
        }

        const user = await userModel.findOne({ email }).select("+password");
        if (!user) {
            return next(new ErrorHandler("Invalid email or password", 400));
        }

        const passwordMatch = await user.comparePassword(password);
        if (!passwordMatch) {
            return next(new ErrorHandler("Invalid password", 400));
        }

        sendToken(user, 200, res);
        console.log(sendToken(user, 200, res));

    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
});

export const logoutUser = CatchAsyncError(
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            res.cookie("access_tokens", "", { maxAge: 1 });
            res.cookie("refresh_tokens", "", { maxAge: 1 });
            const userId = req.user?._id || "";
            redis.del(userId);
            res.status(200).json({
                success: true,
                message: "Logout successfully",
            })
        } catch (error: any) {
            return next(new ErrorHandler(error.message, 400));
        }
    });

//update access token
export const updateAccessToken = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const refresh_token = req.cookies.refresh_tokens as string;
        const decoded = jwt.verify(refresh_token,
            process.env.REFRESH_TOKEN as string) as JwtPayload;
        const message = `could not refresh token`;
        if (!decoded) {
            return next(new ErrorHandler(message, 400));
        }
        const seesion = await redis.get(decoded.id as string);
        if (!seesion) {
            return next(new ErrorHandler(message, 400));
        }
        const user = JSON.parse(seesion);

        const accessToken = jwt.sign({ id: user._id }, process.env.ACCESS_TOKEN as string, {
            expiresIn: "5m"
        });

        const refreshToken = jwt.sign({ id: user._id }, process.env.ACCESS_TOKEN as string, {
            expiresIn: "3d"
        });

        req.user = user;
        res.cookie("access_tokens", accessToken, accessTokenOptions);
        res.cookie("refresh_tokens", refreshToken, refreshTokenOptions);

        res.status(200).json({
            success: true,
            accessToken
        });
    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
});

//get user info
export const getUserInfo = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?._id;
        getUserById(res, userId);
    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
})

interface SocialAuthBody {
    email: string;
    name: string;
    avatar: string;
}

//social auth
export const socialAuth = CatchAsyncError(
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { email, name, avatar } = req.body as SocialAuthBody;
            const user = await userModel.findOne({ email });
            if (!user) {
                const newUser = await userModel.create({ email, name, avatar })
                sendToken(newUser, 201, res);
            }
            else {
                sendToken(user, 200, res);
            }
        } catch (error: any) {
            return next(new ErrorHandler(error.message, 400));
        }
    });

//update user info
interface UpdateUserInfo {
    name?: string;
    email?: string;
}

export const updateUserInfo = CatchAsyncError(
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { name, email } = req.body as UpdateUserInfo;
            const userId = req.user?._id;
            const user = await userModel.findById(userId);

            if (email && user) {
                const emailExist = await userModel.findOne({ email });
                if (emailExist) {
                    return next(new ErrorHandler("Email already exist", 400));
                }
                user.email = email;
            }

            if (name && user) {
                user.name = name;
            }

            await user?.save();
            await redis.set(userId, JSON.stringify(user));
            res.status(201).json({
                success: true,
                user,
            });
        } catch (error: any) {
            return next(new ErrorHandler(error.message, 400));
        }
    });

//update user password
interface UpdatePassword {
    oldPassword: string;
    newPassword: string;
}

export const updatePassword = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { oldPassword, newPassword } = req.body as UpdatePassword;

        if (!oldPassword || !newPassword) {
            return next(new ErrorHandler("Please enter old and new password", 400));
        }

        const user = await userModel.findById(req.user?._id).select("+password");

        if (user?.password === undefined) {
            return next(new ErrorHandler("Invalid user", 400));
        }

        const passwordMatch = await user?.comparePassword(oldPassword);

        if (!passwordMatch) {
            return next(new ErrorHandler("Invalid old password", 400));
        }

        user.password = newPassword;

        await user.save();

        await redis.set(req.user?._id, JSON.stringify(user));
        res.status(201).json({
            success: true, user,
        });
    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
});

interface UpdateProfilePicture {
    avatar: string;
}

//update profile picture
export const updateProfilePicture = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { avatar } = req.body as UpdateProfilePicture;
        const userId = req.user?._id;
        const user = await userModel.findById(userId);

        if (avatar && user) {
            //If the user have one avatar then call this if
            if (user?.avatar?.public_id) {
                //first delete the old image
                await cloudinary.v2.uploader.destroy(user?.avatar?.public_id);

                const cloud = await cloudinary.v2.uploader.upload(avatar, {
                    folder: "avatar",
                    width: 150,
                });
                user.avatar = {
                    public_id: cloud.public_id,
                    url: cloud.secure_url,
                }
            } else {
                const cloud = await cloudinary.v2.uploader.upload(avatar, {
                    folder: "avatar",
                    width: 150,
                });
                user.avatar = {
                    public_id: cloud.public_id,
                    url: cloud.secure_url,
                }
            }
        }

        await user?.save();
        await redis.set(userId, JSON.stringify(user));

        res.status(200).json({
            success: true,
            user,
        });
    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
    }
});
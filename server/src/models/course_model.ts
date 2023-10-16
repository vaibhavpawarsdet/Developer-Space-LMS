import mongoose, { Document } from "mongoose";

interface Comment extends Document{
    user: object,
    comment: string;
}

interface Review extends Document{
    user: object,
    rating: number,
    comment: string;
    commentReplies: Comment[];
}

interface Link extends Document{
    title: string,
    url: string;
}

interface CourseData extends Document{
    title:string;
    description:string;
    videoUrl:string;
    videoThumbnail:object;
    videoSection: string;
    videoLength:number;
    videoPlayer:string;
    links:Link[];
    suggestion: string;
    questions:Comment[];
}

interface Course extends Document{
    name:string;
    description:string;
    price:number;
    estimatedPrice?:number;
    thumbnail:object;
    tags: string;
    level:string;
    demoUrl:string;
    benefits:{title:string}[];
    prerequisites: {title:string}[];
    reviews: Review[];
    courseData: CourseData[];
    ratings?: number;
    purchased: number;
}
import express from 'express';
import { authorize, verifyToken } from '../middleware.js';
import {
	addPostFileUrls,
	createPost,
	deletePostFileUrls,
	downvotePost,
	getPosts,
	upvotePost,
} from '../../database/mongoStuff.js';
import { writeFilesPostContent } from '../../database/fileStorage/multerStuff.js';
import firebaseBucket, { createPersistentDownloadUrl } from '../../database/fileStorage/firebase/firebaseStorage.js';
import ROLE from '../roles.js';

const router = express.Router();

router.post('/create', verifyToken, async (req, res) => {
	try {
		const dbResponse = await createPost(req.body.title, req.body.description, req._id, req.body.city);
		if (dbResponse) res.status(201).send({ postId: dbResponse._id });
		else res.sendStatus(500);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.post('/create/files/:postId', verifyToken, writeFilesPostContent.any(), async (req, res) => {
	try {
		if (req.files.length > 4) {
			res.status(400).send('You can only upload up to 4 files');
			return;
		}

		//deletes the previous url array & firebase files and verifies if post exists
		const post = await deletePostFileUrls(req.params.postId);
		const files = await firebaseBucket.getFiles();
		const filesToDelete = files[0].filter((file) => file.name.includes(`post-files/${req.params.postId}`));
		filesToDelete.forEach(async (file) => {
			await file.delete();
		});

		if (post) {
			req.files.forEach(async (file, index) => {
				// post filename template: postId_order_originalFileName.jpg/mp4
				firebaseBucket.file(`post-files/${req.params.postId}_${index}_${file.originalname}`).save(file.buffer);
				const downloadUrl = createPersistentDownloadUrl(`post-files/${req.params.postId}_${index}_${file.originalname}`);
				await addPostFileUrls(req.params.postId, downloadUrl);
			});
			res.sendStatus(200);
		} else {
			res.sendStatus(400);
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.put('/upvote/:postId', verifyToken, authorize(ROLE.USER), async (req, res) => {
	try {
		const dbResponse = await upvotePost(req.params.postId, req._id); //returns 0 if post isn't found and -1 if user already upvoted
		if (dbResponse === 0) {
			res.sendStatus(404);
			return;
		}
		if (dbResponse === -1) {
			res.sendStatus(204); // when upvote is removed
			return;
		}
		res.sendStatus(200);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});
router.put('/downvote/:postId', verifyToken, authorize(ROLE.USER), async (req, res) => {
	try {
		const dbResponse = await downvotePost(req.params.postId, req._id); //returns 0 if post isn't found and -1 if user already downvoted
		if (dbResponse === 0) {
			res.sendStatus(404);
			return;
		}
		if (dbResponse === -1) {
			res.sendStatus(204); // when downvote is removed
			return;
		}
		res.sendStatus(200);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/all', async (req, res) => {
	try {
		const posts = await getPosts();
		res.send(posts);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

export default router;

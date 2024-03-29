import express from 'express';
import { authorize, verifyToken } from '../middleware.js';
import {
	addPostFileUrls,
	changePostStatus,
	createPost,
	deletePost,
	deletePostFileUrls,
	downvotePost,
	editPost,
	getCityPosts,
	getPostByID,
	getAllPosts,
	getUnverifiedPosts,
	getUserCity,
	getUserPosts,
	isVerified,
	upvotePost,
	verifyPost,
	favouritePost,
	getFavouritePosts,
	getUserEmailFromPost,
} from '../../database/mongoStuff.js';
import { writeFilesPostContent } from '../../database/fileStorage/multerStuff.js';
import firebaseBucket, { createPersistentDownloadUrl } from '../../database/fileStorage/firebase/firebaseStorage.js';
import ROLE from '../roles.js';
import PostModel from '../../database/models/PostModel.js';
import { sendPostRejectedMail } from '../../mail/mail.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.post('/create', verifyToken, async (req, res) => {
	try {
		//check if user is verified
		const verified = await isVerified(req._id);
		if (!verified) res.sendStatus(401);
		else {
			const dbResponse = await createPost(req.body.title, req.body.description, req._id, req.body.city);
			if (dbResponse) res.status(201).send({ postId: dbResponse._id });
			else res.sendStatus(500);
		}
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
		if (process.env.POST_FILES_FIREBASE) {
			const files = await firebaseBucket.getFiles();
			const filesToDelete = files[0].filter((file) => file.name.includes(`post-files/${req.params.postId}`));
			filesToDelete.forEach(async (file) => {
				await file.delete();
			});
		} else {
			//delete post files from local storage
			fs.readdir(process.env.POST_FILES_PATH, (err, files) => {
				if (err) console.log(err);

				files.map((file) => {
					if (file.includes(req.params.postId)) {
						fs.unlink(path.join(process.env.POST_FILES_PATH, file), (err) => {
							if (err) console.log(err);
						});
					}
				});
			});
		}

		if (post) {
			req.files.forEach(async (file, index) => {
				// post filename template: postId_order_originalFileName.jpg/mp4
				let downloadUrl;
				if (process.env.POST_FILES_FIREBASE) {
					firebaseBucket.file(`post-files/${req.params.postId}_${index}_${file.originalname}`).save(file.buffer);
					downloadUrl = createPersistentDownloadUrl(`post-files/${req.params.postId}_${index}_${file.originalname}`);
				} else {
					fs.writeFile(
						path.join(process.env.POST_FILES_PATH, `${req.params.postId}_${index}_${file.originalname}`),
						file.buffer,
						(err) => {
							if (err) console.log(err);
						}
					);
					downloadUrl = `http://${process.env.HOSTNAME}/posts/get-file/${req.params.postId}_${index}_${file.originalname}`;
				}
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

router.put('/approve/:id', verifyToken, authorize(ROLE.MODERATOR), async (req, res) => {
	try {
		await verifyPost(req.params.id);
		res.sendStatus(200);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.put('/deny/:id', verifyToken, authorize(ROLE.MODERATOR), async (req, res) => {
	try {
		const email = await getUserEmailFromPost(req.params.id);
		const dbResponse = await deletePost(req.params.id);
		switch (dbResponse) {
			case 1:
				res.sendStatus(200);
				break;
			case 0:
				res.sendStatus(404);
				break;
			case -1:
				res.sendStatus(403);
				break;
			default:
				res.sendStatus(500);
				break;
		}
		await sendPostRejectedMail(email);
		if (process.env.POST_FILES_FIREBASE) {
			const files = await firebaseBucket.getFiles();
			const filesToDelete = files[0].filter((file) => file.name.includes(`post-files/${req.params.id}`));
			filesToDelete.forEach(async (file) => {
				await file.delete();
			});
		} else {
			//delete post files from local storage
			fs.readdir(process.env.POST_FILES_PATH, (err, files) => {
				if (err) console.log(err);

				files.map((file) => {
					if (file.includes(req.params.id)) {
						fs.unlink(path.join(process.env.POST_FILES_PATH, file), (err) => {
							if (err) console.log(err);
						});
					}
				});
			});
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.put('/edit/:id', verifyToken, async (req, res) => {
	try {
		const dbResponse = await editPost(req.params.id, req._id, req.body.title, req.body.description);
		switch (dbResponse) {
			case 1:
				res.sendStatus(200);
				break;
			case 0:
				res.sendStatus(404);
				break;
			case -1:
				res.sendStatus(403);
				break;
			default:
				res.sendStatus(500);
				break;
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.put('/status', verifyToken, authorize(ROLE.LOCAL_ADMIN), async (req, res) => {
	try {
		let dbResponse;
		switch (req.body.status) {
			case 'sent':
				dbResponse = await changePostStatus(req.body.id, 'sent');
				if (dbResponse) res.sendStatus(200);
				else if (!dbResponse) res.sendStatus(404);
				break;
			case 'seen':
				dbResponse = await changePostStatus(req.body.id, 'seen');
				if (dbResponse) res.sendStatus(200);
				else if (!dbResponse) res.sendStatus(404);
				break;
			case 'in-progress':
				dbResponse = await changePostStatus(req.body.id, 'in-progress');
				if (dbResponse) res.sendStatus(200);
				else if (!dbResponse) res.sendStatus(404);
				break;
			case 'resolved':
				dbResponse = await changePostStatus(req.body.id, 'resolved');
				if (dbResponse) res.sendStatus(200);
				else if (!dbResponse) res.sendStatus(404);
				break;
			default:
				res.sendStatus(400);
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

//this route can also be called to remove upvotes
router.put('/upvote/:postId', verifyToken, authorize(ROLE.USER), async (req, res) => {
	try {
		const dbResponse = await upvotePost(req.params.postId, req._id);
		switch (dbResponse) {
			case 0:
				res.sendStatus(404);
				break;
			case -1:
				res.send('removed upvote');
				break;
			case 1:
				res.send('added upvote and removed downvote');
				break;
			default:
				res.send('added upvote');
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

//this route can also be called to remove downvotes
router.put('/downvote/:postId', verifyToken, authorize(ROLE.USER), async (req, res) => {
	try {
		const dbResponse = await downvotePost(req.params.postId, req._id);
		switch (dbResponse) {
			case 0:
				res.sendStatus(404);
				break;
			case -1:
				res.send('removed downvote');
				break;
			case 1:
				res.send('added downvote and removed upvote');
				break;
			default:
				res.send('added downvote');
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

//this route can also be called to remove downvotes
router.put('/favourite/:postId', verifyToken, authorize(ROLE.USER), async (req, res) => {
	try {
		const dbResponse = await favouritePost(req.params.postId, req._id);
		switch (dbResponse) {
			case 0:
				res.sendStatus(404);
				break;
			case 1:
				res.send('added to favourites');
				break;
			case -1:
				res.send('removed from favourites');
				break;
			default:
				res.sendStatus(500);
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

//*post sort types: date, upvotes, downvotes, sent, seen, in-progress, resolved
router.get('/all', async (req, res) => {
	try {
		const results = {};
		if (req.query.limit) {
			const page = parseInt(req.query.page);
			const limit = parseInt(req.query.limit);
			const sort = req.query.sort;

			const startIndex = (page - 1) * limit;
			const endIndex = page * limit;

			if (endIndex < (await PostModel.countDocuments())) {
				results.next = {
					page: page + 1,
					limit: limit,
				};
			}

			if (startIndex >= 0) {
				if (startIndex > 0)
					results.previous = {
						page: page - 1,
						limit: limit,
					};
				results.posts = await getAllPosts(limit, startIndex, sort);
			} else return res.sendStatus(400);
		} else {
			results.posts = await getAllPosts();
		}

		res.send(results);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/get-file/:filename', async (req, res) => {
	try {
		res.sendFile(path.join(process.env.POST_FILES_PATH, req.params.filename));
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/user/all', verifyToken, async (req, res) => {
	try {
		const posts = await getUserPosts(req._id);
		if (!posts) res.sendStatus(404);
		else res.send(posts);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/favourites', verifyToken, authorize(ROLE.USER), async (req, res) => {
	try {
		const posts = await getFavouritePosts(req._id);
		res.send(posts);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/unverified', verifyToken, authorize(ROLE.MODERATOR), async (req, res) => {
	try {
		const city = await getUserCity(req._id);
		const posts = await getUnverifiedPosts(city);
		res.send(posts);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/city/:city', async (req, res) => {
	try {
		const posts = await getCityPosts(req.params.city, req.query.sort);
		res.send(posts);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/:id', async (req, res) => {
	try {
		const post = await getPostByID(req.params.id);
		if (post) res.send(post);
		else res.sendStatus(404);
	} catch (error) {
		console.log(error);
		if (error.kind === 'ObjectId') res.sendStatus(404);
		else res.sendStatus(500);
	}
});

router.delete('/:id', verifyToken, async (req, res) => {
	try {
		const dbResponse = await deletePost(req.params.id, req._id);
		if (process.env.POST_FILES_FIREBASE) {
			const files = await firebaseBucket.getFiles();
			const filesToDelete = files[0].filter((file) => file.name.includes(`post-files/${req.params.id}`));
			filesToDelete.forEach(async (file) => {
				await file.delete();
			});
		} else {
			//delete post files from local storage
			fs.readdir(process.env.POST_FILES_PATH, (err, files) => {
				if (err) console.log(err);

				files.map((file) => {
					if (file.includes(req.params.id)) {
						fs.unlink(path.join(process.env.POST_FILES_PATH, file), (err) => {
							if (err) console.log(err);
						});
					}
				});
			});
		}
		switch (dbResponse) {
			case 1:
				res.sendStatus(200);
				break;
			case 0:
				res.sendStatus(404);
				break;
			case -1:
				res.sendStatus(403);
				break;
			default:
				res.sendStatus(500);
				break;
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

export default router;

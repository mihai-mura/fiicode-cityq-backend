import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, getUserByEmail } from '../../database/mongoStuff.js';
import { verifyToken } from '../middleware.js';
import { writeFileIdPicture } from '../../database/fileStorage/multerStuff.js';

const router = express.Router();

router.post('/register', async (req, res) => {
	try {
		const hashedPass = await bcrypt.hash(req.body.password, 10);
		const dbResponse = await createUser(
			req.body.email,
			hashedPass,
			req.body.firstName,
			req.body.lastName,
			req.body.city,
			req.body.address,
			'user'
		);
		if (dbResponse === 11000) {
			//* duplicate error
			res.status(409).send('email already in use');
		} else {
			//* dbResponse is the user _id
			const token = jwt.sign(
				{
					_id: dbResponse,
				},
				process.env.JWT_SECRET
			);
			res.status(201).send({ token, _id: dbResponse });
		}
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.post('/register/id', verifyToken, writeFileIdPicture.single('idPic'), (req, res) => {
	res.sendStatus(200);
});

router.post('/login', async (req, res) => {
	try {
		const user = await getUserByEmail(req.body.email);
		if (user) {
			if (await bcrypt.compare(req.body.password, user.password)) {
				const token = jwt.sign(
					{
						_id: user._id,
					},
					process.env.JWT_SECRET
				);
				res.send({ token, _id: user._id });
			} else res.sendStatus(403);
		} else res.sendStatus(404);
	} catch (error) {
		console.log(error);
		res.sendStatus(500);
	}
});

router.get('/profile-pic/:id', (req, res) => {
	const _id = req.params.id;
	res.sendFile(`${process.env.PROFILE_PIC_PATH}/${_id}.png`);
});

export default router;

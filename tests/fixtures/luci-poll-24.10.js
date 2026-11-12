	const Poll = Class.singleton(/** @lends LuCI.poll.prototype */ {
		__name__: 'LuCI.poll',

		queue: [],

		/**
		 * Add a new operation to the polling loop. If the polling loop is not
		 * already started at this point, it will be implicitly started.
		 *
		 * @instance
		 * @memberof LuCI.poll
		 * @param {function} fn
		 * The function to invoke on each poll interval.
		 *
		 * @param {number} interval
		 * The poll interval in seconds.
		 *
		 * @throws {TypeError}
		 * Throws `TypeError` when an invalid interval was passed.
		 *
		 * @returns {boolean}
		 * Returns `true` if the function has been added or `false` if it
		 * already is registered.
		 */
		add(fn, interval) {
			if (interval == null || interval <= 0)
				interval = env.pollinterval || null;

			if (isNaN(interval) || typeof(fn) != 'function')
				throw new TypeError('Invalid argument to LuCI.poll.add()');

			for (let i = 0; i < this.queue.length; i++)
				if (this.queue[i].fn === fn)
					return false;

			const e = {
				r: true,
				i: interval >>> 0,
				fn
			};

			this.queue.push(e);

			if (this.tick != null && !this.active())
				this.start();

			return true;
		},

		/**
		 * Remove an operation from the polling loop. If no further operations
		 * are registered, the polling loop is implicitly stopped.
		 *
		 * @instance
		 * @memberof LuCI.poll
		 * @param {function} fn
		 * The function to remove.
		 *
		 * @throws {TypeError}
		 * Throws `TypeError` when the given argument isn't a function.
		 *
		 * @returns {boolean}
		 * Returns `true` if the function has been removed or `false` if it
		 * wasn't found.
		 */
		remove(fn) {
			if (typeof(fn) != 'function')
				throw new TypeError('Invalid argument to LuCI.poll.remove()');

			const len = this.queue.length;

			for (let i = len; i > 0; i--)
				if (this.queue[i-1].fn === fn)
					this.queue.splice(i-1, 1);

			if (!this.queue.length && this.stop())
				this.tick = 0;

			return (this.queue.length != len);
		},

		/**
		 * (Re)start the polling loop. Dispatches a custom `poll-start` event
		 * to the `document` object upon successful start.
		 *
		 * @instance
		 * @memberof LuCI.poll
		 * @returns {boolean}
		 * Returns `true` if polling has been started (or if no functions
		 * where registered) or `false` when the polling loop already runs.
		 */
		start() {
			if (this.active())
				return false;

			this.tick = 0;

			if (this.queue.length) {
				this.timer = window.setInterval(this.step, 1000);
				this.step();
				document.dispatchEvent(new CustomEvent('poll-start'));
			}

			return true;
		},

		/**
		 * Stop the polling loop. Dispatches a custom `poll-stop` event
		 * to the `document` object upon successful stop.
		 *
		 * @instance
		 * @memberof LuCI.poll
		 * @returns {boolean}
		 * Returns `true` if polling has been stopped or `false` if it didn't
		 * run to begin with.
		 */
		stop() {
			if (!this.active())
				return false;

			document.dispatchEvent(new CustomEvent('poll-stop'));
			window.clearInterval(this.timer);
			delete this.timer;
			delete this.tick;
			return true;
		},

		/* private */
		step() {
			for (let i = 0, e = null; (e = Poll.queue[i]) != null; i++) {
				if ((Poll.tick % e.i) != 0)
					continue;

				if (!e.r)
					continue;

				e.r = false;

				Promise.resolve(e.fn()).finally((function() { this.r = true }).bind(e));
			}

			Poll.tick = (Poll.tick + 1) % Math.pow(2, 32);
		},

		/**
		 * Test whether the polling loop is running.
		 *
		 * @instance
		 * @memberof LuCI.poll
		 * @returns {boolean} - Returns `true` if polling is active, else `false`.
		 */
		active() {
			return (this.timer != null);
		}
	});

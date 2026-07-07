// src/utils/sendNotification.js

const Notification = require(
  "../models/notification"
);

const User = require(
  "../models/user"
);

const admin = require(
  "firebase-admin"
);

const {
  getIO,
} = require("./socketInstance");

// ======================================================
// Push-token helpers
// ======================================================

function isExpoPushToken(token) {
  return (
    typeof token === "string" &&
    (
      token.startsWith(
        "ExpoPushToken["
      ) ||
      token.startsWith(
        "ExponentPushToken["
      )
    )
  );
}

function normalizeTokenEntry(entry) {
  if (!entry) {
    return null;
  }

  if (
    typeof entry === "string"
  ) {
    const token =
      entry.trim();

    if (!token) {
      return null;
    }

    return {
      token,

      provider:
        isExpoPushToken(token)
          ? "expo"
          : "fcm",

      platform:
        "unknown",
    };
  }

  const token =
    String(
      entry.token ||
      entry.deviceToken ||
      ""
    ).trim();

  if (!token) {
    return null;
  }

  const rawProvider =
    String(
      entry.provider || ""
    )
      .trim()
      .toLowerCase();

  return {
    token,

    provider:
      rawProvider ||
      (
        isExpoPushToken(token)
          ? "expo"
          : "fcm"
      ),

    platform:
      entry.platform ||
      "unknown",
  };
}

// ======================================================
// General helpers
// ======================================================

function normalizeString(
  value,
  maximumLength = 2000
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(
      0,
      maximumLength
    );
}

function normalizeNullableObjectId(
  value
) {
  return value || null;
}

function normalizeNullableInteger(
  value,
  minimum = 0
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < minimum
  ) {
    return null;
  }

  return parsed;
}

function normalizeMediaType(value) {
  const normalized =
    normalizeString(
      value,
      20
    ).toLowerCase();

  if (
    [
      "movie",
      "tv",
      "none",
    ].includes(normalized)
  ) {
    return normalized;
  }

  return "none";
}

function normalizeTargetType(value) {
  const normalized =
    normalizeString(
      value,
      50
    );

  const validTargets =
    new Set([
      "none",
      "profile",
      "movie",
      "movieReview",
      "show",
      "showReview",
      "episode",
      "episodeReview",
      "list",
      "notifications",
      "externalUrl",
    ]);

  return validTargets.has(
    normalized
  )
    ? normalized
    : "none";
}

function buildMessage({
  type,
  from,
  showTitle,
  episodeTitle,
  movieTitle,
}) {
  const username =
    from?.username
      ? `@${from.username}`
      : "Scene";

  switch (type) {
    // ==============================================
    // Shared
    // ==============================================

    case "follow":
      return `👤 ${username} just followed you`;

    case "reaction":
      return `❤️ ${username} liked your reply`;

    case "reply":
      return `💬 ${username} replied to your comment`;

    case "share-list":
    case "list_shared":
      return `📋 ${username} shared a list with you`;

    // ==============================================
    // Movie
    // ==============================================

    case "review_like":
    case "movie_review_like":
      return `❤️ ${username} liked your movie review`;

    case "movie_review_comment":
      return `💬 ${username} commented on your movie review`;

    case "suggest_movie":
      return `🎬 ${username} suggested a movie for you`;

    case "share-movie":
    case "movie_shared":
      return movieTitle
        ? `🎞️ ${username} shared ${movieTitle} with you`
        : `🎞️ ${username} shared a movie with you`;

    case "share-review":
      return `✍️ ${username} shared a review with you`;

    // ==============================================
    // TV episode logs/reviews
    // ==============================================

    case "tv_log_like":
    case "episode_review_like":
      return `❤️ ${username} liked your episode review`;

    case "tv_log_reply":
    case "episode_review_comment":
      return `💬 ${username} commented on your episode review`;

    case "episode_shared":
      return episodeTitle
        ? `📺 ${username} shared ${episodeTitle} with you`
        : `📺 ${username} shared an episode with you`;

    // ==============================================
    // TV show reviews
    // ==============================================

    case "show_review_like":
      return `❤️ ${username} liked your show review`;

    case "show_review_reply":
    case "show_review_comment":
      return `💬 ${username} commented on your show review`;

    case "show_shared":
      return showTitle
        ? `📺 ${username} shared ${showTitle} with you`
        : `📺 ${username} shared a show with you`;

    // ==============================================
    // TV progress
    // ==============================================

    case "show_started":
      return showTitle
        ? `📺 ${username} started watching ${showTitle}`
        : `📺 ${username} started a show`;

    case "show_completed":
      return showTitle
        ? `🏆 ${username} completed ${showTitle}`
        : `🏆 ${username} completed a show`;

    // ==============================================
    // TV releases
    // ==============================================

    case "new_episode":
      if (
        showTitle &&
        episodeTitle
      ) {
        return `📺 A new episode of ${showTitle} is available: ${episodeTitle}`;
      }

      if (showTitle) {
        return `📺 A new episode of ${showTitle} is available`;
      }

      return "📺 A new episode is available";

    // ==============================================
    // General/system
    // ==============================================

    case "system":
      return "🔔 You have a new message from Scene";

    default:
      return from?.username
        ? `🔔 ${username} sent you a notification`
        : "🔔 You have a new Scene notification";
  }
}

function getMuteSettingForType(type) {
  const typeToSetting = {
    follow:
      "muteFollow",

    reply:
      "muteReplies",

    movie_review_comment:
      "muteReplies",

    episode_review_comment:
      "muteReplies",

    tv_log_reply:
      "muteReplies",

    show_review_reply:
      "muteReplies",

    show_review_comment:
      "muteReplies",

    reaction:
      "muteLikes",

    review_like:
      "muteLikes",

    movie_review_like:
      "muteLikes",

    episode_review_like:
      "muteLikes",

    tv_log_like:
      "muteLikes",

    show_review_like:
      "muteLikes",

    "share-movie":
      "muteShares",

    "share-list":
      "muteShares",

    "share-review":
      "muteShares",

    movie_shared:
      "muteShares",

    show_shared:
      "muteShares",

    episode_shared:
      "muteShares",

    list_shared:
      "muteShares",

    suggest_movie:
      "muteSuggestions",
  };

  return (
    typeToSetting[type] ||
    null
  );
}

// ======================================================
// Expo push
// ======================================================

async function sendExpoPushes({
  expoEntries,
  message,
  data,
  badge,
}) {
  const invalidTokens =
    new Set();

  const messages =
    expoEntries
      .filter((entry) => {
        if (
          isExpoPushToken(
            entry.token
          )
        ) {
          return true;
        }

        console.warn(
          "⚠️ Invalid Expo push token skipped:",
          entry.token
        );

        invalidTokens.add(
          entry.token
        );

        return false;
      })
      .map((entry) => ({
        to:
          entry.token,

        sound:
          "default",

        title:
          "Scene",

        body:
          message,

        data,

        badge,

        priority:
          "high",

        channelId:
          "default",
      }));

  if (!messages.length) {
    return invalidTokens;
  }

  console.log(
    `📨 Sending Expo push: ${messages.length} message(s)`
  );

  const BATCH_SIZE = 100;

  for (
    let index = 0;
    index < messages.length;
    index += BATCH_SIZE
  ) {
    const batch =
      messages.slice(
        index,
        index + BATCH_SIZE
      );

    try {
      const response =
        await fetch(
          "https://exp.host/--/api/v2/push/send",
          {
            method:
              "POST",

            headers: {
              Accept:
                "application/json",

              "Accept-Encoding":
                "gzip, deflate",

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                batch.length === 1
                  ? batch[0]
                  : batch
              ),
          }
        );

      let result = null;

      try {
        result =
          await response.json();
      } catch (jsonError) {
        console.error(
          "❌ Expo push non-JSON response:",
          jsonError?.message ||
          jsonError
        );
      }

      if (!response.ok) {
        console.error(
          "❌ Expo push HTTP error:",
          response.status,
          result
        );

        continue;
      }

      const tickets =
        Array.isArray(
          result?.data
        )
          ? result.data
          : result?.data
          ? [result.data]
          : [];

      tickets.forEach(
        (
          ticket,
          ticketIndex
        ) => {
          if (
            !ticket ||
            ticket.status === "ok"
          ) {
            return;
          }

          const failedToken =
            batch[
              ticketIndex
            ]?.to;

          console.error(
            "❌ Expo push failed:",
            failedToken,
            ticket.message,
            ticket.details
          );

          if (
            ticket.details
              ?.error ===
              "DeviceNotRegistered" &&
            failedToken
          ) {
            invalidTokens.add(
              failedToken
            );
          }
        }
      );

      console.log(
        `✅ Expo push batch sent: ${batch.length}`
      );
    } catch (error) {
      console.error(
        "❌ Expo push fetch error:",
        error?.message ||
        error
      );
    }
  }

  return invalidTokens;
}

// ======================================================
// Firebase push
// ======================================================

async function sendFcmPushes({
  fcmEntries,
  message,
  data,
  badge,
}) {
  const invalidTokens =
    new Set();

  const fcmTokens =
    fcmEntries
      .map(
        (entry) =>
          entry.token
      )
      .filter(Boolean);

  if (!fcmTokens.length) {
    return invalidTokens;
  }

  const payload = {
    notification: {
      title:
        "Scene",

      body:
        message,
    },

    data,

    apns: {
      headers: {
        "apns-priority":
          "10",

        "apns-push-type":
          "alert",
      },

      payload: {
        aps: {
          sound:
            "default",

          badge,
        },
      },
    },

    android: {
      priority:
        "high",

      notification: {
        sound:
          "default",

        channelId:
          "default",
      },
    },
  };

  try {
    const BATCH_SIZE = 450;

    console.log(
      `📨 Sending FCM push: ${fcmTokens.length} token(s)`
    );

    for (
      let index = 0;
      index < fcmTokens.length;
      index += BATCH_SIZE
    ) {
      const batch =
        fcmTokens.slice(
          index,
          index + BATCH_SIZE
        );

      const response =
        await admin
          .messaging()
          .sendEachForMulticast({
            tokens:
              batch,

            notification:
              payload.notification,

            data:
              payload.data,

            apns:
              payload.apns,

            android:
              payload.android,
          });

      console.log(
        `✅ FCM push batch result: success=${response.successCount}, failure=${response.failureCount}`
      );

      response.responses.forEach(
        (
          result,
          resultIndex
        ) => {
          if (result.success) {
            return;
          }

          const error =
            result.error;

          const failedToken =
            batch[resultIndex];

          console.error(
            "❌ FCM token failed:",
            failedToken,
            error?.code,
            error?.message
          );

          if (
            error?.code ===
              "messaging/registration-token-not-registered" ||
            error?.code ===
              "messaging/invalid-registration-token"
          ) {
            invalidTokens.add(
              failedToken
            );
          }
        }
      );
    }
  } catch (error) {
    console.error(
      "❌ FCM send error:",
      error?.message ||
      error
    );
  }

  return invalidTokens;
}

// ======================================================
// Main notification function
// ======================================================

const sendNotification = async ({
  type,

  // May be null for Scene/system/release notifications.
  fromUserId = null,

  toUserId,

  message = "",

  mediaType = "none",
  targetType = "none",
  targetUrl = "",

  relatedId = "",
  listId = null,
  reviewId = "",

  // Movie
  movieId = "",
  movieTitle = "",
  moviePoster = "",
  movieLogId = null,

  // TV show
  showId = "",
  showTitle = "",
  showPoster = "",
  showBackdrop = "",

  // TV episode
  seasonNumber = null,
  episodeNumber = null,
  episodeId = "",
  episodeTitle = "",
  episodeBackdrop = "",

  // TV review references
  tvLogId = null,
  showReviewId = null,

  deduplicationKey = null,
  metadata = {},
}) => {
  try {
    if (
      !type ||
      !toUserId
    ) {
      console.warn(
        "❌ sendNotification: type and toUserId are required"
      );

      return null;
    }

    if (
      fromUserId &&
      String(fromUserId) ===
        String(toUserId)
    ) {
      console.log(
        "🔕 Notification skipped: user notified themselves"
      );

      return null;
    }

    const [
      from,
      to,
    ] = await Promise.all([
      fromUserId
        ? User.findById(
            fromUserId
          ).select(
            "username avatar"
          )
        : Promise.resolve(
            null
          ),

      User.findById(
        toUserId
      ).select(
        "deviceTokens pushSettings"
      ),
    ]);

    if (
      fromUserId &&
      !from
    ) {
      console.warn(
        "❌ sendNotification: sender not found"
      );

      return null;
    }

    if (!to) {
      console.warn(
        "❌ sendNotification: recipient not found"
      );

      return null;
    }

    const finalMessage =
      normalizeString(
        message,
        2000
      ) ||
      buildMessage({
        type,
        from,
        showTitle,
        episodeTitle,
        movieTitle,
      });

    const notificationData = {
      type:
        normalizeString(
          type,
          200
        ),

      from:
        fromUserId ||
        null,

      to:
        toUserId,

      message:
        finalMessage,

      mediaType:
        normalizeMediaType(
          mediaType
        ),

      targetType:
        normalizeTargetType(
          targetType
        ),

      targetUrl:
        normalizeString(
          targetUrl,
          2000
        ),

      relatedId:
        normalizeString(
          String(
            relatedId || ""
          ),
          500
        ),

      listId:
        normalizeNullableObjectId(
          listId
        ),

      reviewId:
        normalizeString(
          String(
            reviewId || ""
          ),
          500
        ),

      movieId:
        normalizeString(
          String(
            movieId || ""
          ),
          500
        ),

      movieTitle:
        normalizeString(
          movieTitle,
          1000
        ),

      moviePoster:
        normalizeString(
          moviePoster,
          2000
        ),

      movieLogId:
        normalizeNullableObjectId(
          movieLogId
        ),

      showId:
        normalizeString(
          String(
            showId || ""
          ),
          500
        ),

      showTitle:
        normalizeString(
          showTitle,
          1000
        ),

      showPoster:
        normalizeString(
          showPoster,
          2000
        ),

      showBackdrop:
        normalizeString(
          showBackdrop,
          2000
        ),

      seasonNumber:
        normalizeNullableInteger(
          seasonNumber,
          0
        ),

      episodeNumber:
        normalizeNullableInteger(
          episodeNumber,
          1
        ),

      episodeId:
        normalizeString(
          String(
            episodeId || ""
          ),
          500
        ),

      episodeTitle:
        normalizeString(
          episodeTitle,
          1000
        ),

      episodeBackdrop:
        normalizeString(
          episodeBackdrop,
          2000
        ),

      tvLogId:
        normalizeNullableObjectId(
          tvLogId
        ),

      showReviewId:
        normalizeNullableObjectId(
          showReviewId
        ),

      deduplicationKey:
        normalizeString(
          deduplicationKey,
          1000
        ) || null,

      metadata:
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
          ? metadata
          : {},

      read:
        false,

      readAt:
        null,
    };

    let createdNotif = null;

    // ==================================================
    // Deduplicated creation
    // ==================================================

    if (
      notificationData
        .deduplicationKey
    ) {
      const upsertResult =
        await Notification.updateOne(
          {
            to:
              toUserId,

            deduplicationKey:
              notificationData
                .deduplicationKey,
          },
          {
            $setOnInsert:
              notificationData,
          },
          {
            upsert:
              true,

            runValidators:
              true,

            setDefaultsOnInsert:
              true,
          }
        );

      const wasCreated =
        Boolean(
          upsertResult.upsertedCount ||
          upsertResult.upsertedId
        );

      createdNotif =
        await Notification.findOne({
          to:
            toUserId,

          deduplicationKey:
            notificationData
              .deduplicationKey,
        });

      if (!createdNotif) {
        console.warn(
          "⚠️ Deduplicated notification could not be loaded"
        );

        return null;
      }

      if (!wasCreated) {
        console.log(
          "🔕 Duplicate notification skipped:",
          notificationData
            .deduplicationKey
        );

        return Notification.findById(
          createdNotif._id
        )
          .populate(
            "from",
            "username avatar"
          )
          .lean({
            virtuals: true,
          });
      }
    } else {
      createdNotif =
        await Notification.create(
          notificationData
        );
    }

    const notif =
      await Notification.findById(
        createdNotif._id
      )
        .populate(
          "from",
          "username avatar"
        )
        .lean({
          virtuals: true,
        });

    if (!notif) {
      console.warn(
        "⚠️ Created notification could not be loaded"
      );

      return null;
    }

    // ==================================================
    // Live Socket.IO notification
    // ==================================================

    try {
      const io =
        getIO();

      if (io) {
        io
          .to(
            String(
              toUserId
            )
          )
          .emit(
            "notification",
            notif
          );
      }
    } catch (socketError) {
      console.warn(
        "⚠️ Socket emit failed:",
        socketError?.message ||
        socketError
      );
    }

    // ==================================================
    // Push settings
    // ==================================================

    const pushSettings =
      to.pushSettings || {};

    if (
      pushSettings.muteAll
    ) {
      console.log(
        "🔕 Push skipped: muteAll enabled"
      );

      return notif;
    }

    const muteKey =
      getMuteSettingForType(
        type
      );

    if (
      muteKey &&
      pushSettings[muteKey]
    ) {
      console.log(
        `🔕 Push skipped: ${muteKey} enabled`
      );

      return notif;
    }

    // ==================================================
    // Push tokens
    // ==================================================

    const tokenEntries =
      Array.isArray(
        to.deviceTokens
      )
        ? to.deviceTokens
            .map(
              normalizeTokenEntry
            )
            .filter(Boolean)
        : [];

    if (
      !tokenEntries.length
    ) {
      console.log(
        `⚠️ No device tokens for user ${toUserId}`
      );

      return notif;
    }

    const expoEntries =
      tokenEntries.filter(
        (entry) =>
          entry.provider ===
            "expo" ||
          isExpoPushToken(
            entry.token
          )
      );

    const fcmEntries =
      tokenEntries.filter(
        (entry) =>
          entry.provider ===
            "fcm" &&
          !isExpoPushToken(
            entry.token
          )
      );

    console.log(
      `📲 Push tokens for ${toUserId}: expo=${expoEntries.length}, fcm=${fcmEntries.length}`
    );

    const unreadCount =
      await Notification.countDocuments({
        to:
          toUserId,

        read:
          false,
      });

    // Firebase data values must all be strings.
    const data = {
      type:
        String(
          notif.type || ""
        ),

      notificationId:
        String(
          notif._id || ""
        ),

      mediaType:
        String(
          notif.mediaType ||
          "none"
        ),

      targetType:
        String(
          notif.targetType ||
          "none"
        ),

      targetUrl:
        String(
          notif.targetUrl ||
          ""
        ),

      relatedId:
        String(
          notif.relatedId ||
          ""
        ),

      movieId:
        String(
          notif.movieId ||
          ""
        ),

      movieLogId:
        String(
          notif.movieLogId ||
          ""
        ),

      listId:
        String(
          notif.listId ||
          ""
        ),

      reviewId:
        String(
          notif.reviewId ||
          ""
        ),

      showId:
        String(
          notif.showId ||
          ""
        ),

      seasonNumber:
        notif.seasonNumber ===
          null ||
        notif.seasonNumber ===
          undefined
          ? ""
          : String(
              notif.seasonNumber
            ),

      episodeNumber:
        notif.episodeNumber ===
          null ||
        notif.episodeNumber ===
          undefined
          ? ""
          : String(
              notif.episodeNumber
            ),

      episodeId:
        String(
          notif.episodeId ||
          ""
        ),

      tvLogId:
        String(
          notif.tvLogId ||
          ""
        ),

      showReviewId:
        String(
          notif.showReviewId ||
          ""
        ),

      fromUserId:
        String(
          fromUserId ||
          ""
        ),
    };

    const invalidExpoTokens =
      await sendExpoPushes({
        expoEntries,

        message:
          finalMessage,

        data,

        badge:
          unreadCount,
      });

    const invalidFcmTokens =
      await sendFcmPushes({
        fcmEntries,

        message:
          finalMessage,

        data,

        badge:
          unreadCount,
      });

    const invalidTokens =
      new Set([
        ...invalidExpoTokens,
        ...invalidFcmTokens,
      ]);

    if (
      invalidTokens.size
    ) {
      to.deviceTokens =
        (
          to.deviceTokens ||
          []
        ).filter((entry) => {
          const token =
            typeof entry ===
              "string"
              ? entry
              : entry?.token ||
                entry
                  ?.deviceToken;

          return (
            token &&
            !invalidTokens.has(
              token
            )
          );
        });

      await to.save();

      console.log(
        `🧹 Removed ${invalidTokens.size} invalid push token(s) from user ${toUserId}`
      );
    }

    return notif;
  } catch (error) {
    if (
      error?.code === 11000
    ) {
      console.log(
        "🔕 Duplicate notification prevented"
      );

      return null;
    }

    console.error(
      "❌ Error in sendNotification:",
      error
    );

    return null;
  }
};

module.exports =
  sendNotification;
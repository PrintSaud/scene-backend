// src/models/tvImportJob.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Import options
// ======================================================

const importOptionsSchema = new Schema(
  {
    importWatchHistory: {
      type: Boolean,
      default: true,
    },

    importRatings: {
      type: Boolean,
      default: true,
    },

    importReviews: {
      type: Boolean,
      default: true,
    },

    importWatchlist: {
      type: Boolean,
      default: true,
    },

    importRewatches: {
      type: Boolean,
      default: true,
    },

    preserveWatchDates: {
      type: Boolean,
      default: true,
    },

    includeSpecials: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  }
);

// ======================================================
// Import statistics
// ======================================================

const importStatsSchema = new Schema(
  {
    rowsRead: {
      type: Number,
      default: 0,
      min: 0,
    },

    showsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    episodesDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    ratingsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    watchDatesDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    rewatchesDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    favoriteCharacterVotesDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    watchLaterShowsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    favoriteShowsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    listsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    commentRecordsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    recoverableCommentBodiesDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    archiveFilesDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    reviewsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    watchlistItemsDetected: {
      type: Number,
      default: 0,
      min: 0,
    },

    matchedShows: {
      type: Number,
      default: 0,
      min: 0,
    },

    unmatchedShows: {
      type: Number,
      default: 0,
      min: 0,
    },

    uncertainShows: {
      type: Number,
      default: 0,
      min: 0,
    },

    matchedEpisodes: {
      type: Number,
      default: 0,
      min: 0,
    },

    unmatchedEpisodes: {
      type: Number,
      default: 0,
      min: 0,
    },

    logsCreated: {
      type: Number,
      default: 0,
      min: 0,
    },

    duplicateLogsSkipped: {
      type: Number,
      default: 0,
      min: 0,
    },

    watchlistItemsImported: {
      type: Number,
      default: 0,
      min: 0,
    },

    ratingsImported: {
      type: Number,
      default: 0,
      min: 0,
    },

    reviewsImported: {
      type: Number,
      default: 0,
      min: 0,
    },

    errors: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

// ======================================================
// Grouped warning summary
// ======================================================

const importWarningSchema = new Schema(
  {
    code: {
      type: String,
      default: "",
      trim: true,
    },

    message: {
      type: String,
      default: "",
      trim: true,
    },

    count: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    _id: false,
  }
);

// ======================================================
// TV import job
// ======================================================

// ======================================================
// TV Time → TMDB show resolution
// ======================================================

const showResolutionCandidateSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      default: null,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    originalName: {
      type: String,
      default: "",
      trim: true,
    },

    firstAirDate: {
      type: String,
      default: "",
      trim: true,
    },

    year: {
      type: Number,
      default: null,
    },

    posterPath: {
      type: String,
      default: "",
      trim: true,
    },

    backdropPath: {
      type: String,
      default: "",
      trim: true,
    },

    originCountry: {
      type: [String],
      default: [],
    },

    popularity: {
      type: Number,
      default: 0,
    },

    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
  },
  {
    _id: false,
  }
);

const orphanEpisodePatternSchema = new Schema(
  {
    seasonNumber: {
      type: Number,
      required: true,
      min: 0,
    },

    episodes: {
      type: [Number],
      default: [],
    },
  },
  {
    _id: false,
  }
);

const episodeResolutionIssueSchema = new Schema(
  {
    sourceEpisodeId: {
      type: String,
      default: "",
      trim: true,
    },

    sourceKey: {
      type: String,
      default: "",
      trim: true,
    },

    sourceName: {
      type: String,
      default: "",
      trim: true,
    },

    showTmdbId: {
      type: Number,
      default: null,
    },

    seasonNumber: {
      type: Number,
      default: null,
    },

    episodeNumber: {
      type: Number,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "blocked_show",
        "invalid_position",
        "missing_tmdb_episode",
        "special",
      ],
      required: true,
    },

    reason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const episodeResolutionSummarySchema = new Schema(
  {
    totalSourceEpisodes: {
      type: Number,
      default: 0,
      min: 0,
    },

    exactMatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    directMatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    externalIdMatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    compatibilityMatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    manualRecoveryRecords: {
      type: Number,
      default: 0,
      min: 0,
    },

    specials: {
      type: Number,
      default: 0,
      min: 0,
    },

    blockedByUnresolvedShows: {
      type: Number,
      default: 0,
      min: 0,
    },

    invalidPositions: {
      type: Number,
      default: 0,
      min: 0,
    },

    missingTmdbEpisodes: {
      type: Number,
      default: 0,
      min: 0,
    },

    duplicateSourceRows: {
      type: Number,
      default: 0,
      min: 0,
    },

    preservedWatchDates: {
      type: Number,
      default: 0,
      min: 0,
    },

    resolvedShows: {
      type: Number,
      default: 0,
      min: 0,
    },

    resolvedSeasons: {
      type: Number,
      default: 0,
      min: 0,
    },

    syncedSeasons: {
      type: Number,
      default: 0,
      min: 0,
    },

    generatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);


// ======================================================
// Dry-run execution plan summary
// ======================================================

const importPlanSummarySchema =
  new Schema(
    {
      totalSourceRecords: {
        type: Number,
        default: 0,
        min: 0,
      },

      resolvedRecords: {
        type: Number,
        default: 0,
        min: 0,
      },

      readyToCreate: {
        type: Number,
        default: 0,
        min: 0,
      },

      alreadyImported: {
        type: Number,
        default: 0,
        min: 0,
      },

      skippedUnresolved: {
        type: Number,
        default: 0,
        min: 0,
      },

      skippedSpecials: {
        type: Number,
        default: 0,
        min: 0,
      },

      invalidResolvedRows: {
        type: Number,
        default: 0,
        min: 0,
      },

      showsAffected: {
        type: Number,
        default: 0,
        min: 0,
      },

      uniqueEpisodesAffected: {
        type: Number,
        default: 0,
        min: 0,
      },

      rewatchLogs: {
        type: Number,
        default: 0,
        min: 0,
      },

      ratingsAttached: {
        type: Number,
        default: 0,
        min: 0,
      },

      characterVotesAttached: {
        type: Number,
        default: 0,
        min: 0,
      },

      preservedWatchDates: {
        type: Number,
        default: 0,
        min: 0,
      },

      accountingDifference: {
        type: Number,
        default: 0,
      },

      planHash: {
        type: String,
        default: "",
        trim: true,
      },

      generatedAt: {
        type: Date,
        default: null,
      },
    },
    {
      _id: false,
    }
  );

const showResolutionSchema = new Schema(
  {
    sourceKey: {
      type: String,
      required: true,
      trim: true,
    },

    sourceId: {
      type: String,
      default: "",
      trim: true,
    },

    sourceName: {
      type: String,
      required: true,
      trim: true,
    },

    normalizedSourceName: {
      type: String,
      default: "",
      trim: true,
    },

    sourceNameMissing: {
      type: Boolean,
      default: false,
    },

    reportedEpisodesSeen: {
      type: Number,
      default: 0,
      min: 0,
    },

    recoveredEpisodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    episodePattern: {
      type: [orphanEpisodePatternSchema],
      default: [],
    },

    firstWatchDate: {
      type: Date,
      default: null,
    },

    lastWatchDate: {
      type: Date,
      default: null,
    },

    episodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    followed: {
      type: Boolean,
      default: false,
    },

    favorite: {
      type: Boolean,
      default: false,
    },

    watchLater: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: [
        "matched",
        "uncertain",
        "unmatched",
        "confirmed",
        "rejected",
      ],
      default: "unmatched",
      index: true,
    },

    selectedTmdbId: {
      type: Number,
      default: null,
    },

    confidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },

    reason: {
      type: String,
      default: "",
      trim: true,
    },

    candidates: {
      type: [showResolutionCandidateSchema],
      default: [],
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    confirmedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const tvImportJobSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    source: {
      type: String,
      enum: ["tv_time", "scene", "other"],
      default: "tv_time",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "uploaded",
        "parsing",
        "preview_ready",
        "importing",
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
      ],
      default: "uploaded",
      required: true,
      index: true,
    },

    // ==================================================
    // Uploaded file metadata
    // ==================================================

    originalFileName: {
      type: String,
      default: "",
      trim: true,
    },

    mimeType: {
      type: String,
      default: "",
      trim: true,
    },

    fileSizeBytes: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * SHA-256 or another stable content hash.
     *
     * null means hashing has not completed or no hash is available.
     */
    fileHash: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Private temporary-storage identifier.
     *
     * Never expose this in public API responses.
     */
    storageKey: {
      type: String,
      default: "",
      trim: true,
      select: false,
    },

    /**
     * Version of Scene's importer behavior, not the source file.
     */
    importVersion: {
      type: Number,
      default: 1,
      min: 1,
    },

    // ==================================================
    // User-selected behavior
    // ==================================================

    options: {
      type: importOptionsSchema,
      default: () => ({}),
    },

    // ==================================================
    // Progress and results
    // ==================================================

    progressPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    currentStage: {
      type: String,
      default: "",
      trim: true,
    },

    stats: {
      type: importStatsSchema,
      default: () => ({}),
    },

    /**
     * Only grouped warning summaries belong here.
     *
     * Unmatched or unresolved source rows will get a separate model
     * after the real TV Time export format is inspected.
     */
    warnings: {
      type: [importWarningSchema],
      default: [],
    },

    showResolution: {
      type: [showResolutionSchema],
      default: [],
    },

    episodeResolutionSummary: {
      type: episodeResolutionSummarySchema,
      default: () => ({}),
    },

    episodeResolutionIssues: {
      type: [episodeResolutionIssueSchema],
      default: [],
    },

    importPlanSummary: {
      type: importPlanSummarySchema,
      default: () => ({}),
    },

    // ==================================================
    // Retry and recovery
    // ==================================================

    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    /**
     * Last successfully completed logical stage.
     *
     * This allows a future worker to resume safely without defining
     * the exact source-row format today.
     */
    resumeFromStage: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Failure information
    // ==================================================

    errorCode: {
      type: String,
      default: "",
      trim: true,
    },

    errorMessage: {
      type: String,
      default: "",
      trim: true,
    },

    failedStage: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Timeline
    // ==================================================

    parsingStartedAt: {
      type: Date,
      default: null,
    },

    previewReadyAt: {
      type: Date,
      default: null,
    },

    importingStartedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ======================================================
// Indexes
// ======================================================

// User import history.
tvImportJobSchema.index({
  user: 1,
  createdAt: -1,
});

// Find currently active imports.
tvImportJobSchema.index({
  user: 1,
  status: 1,
  createdAt: -1,
});

// Detect a previously uploaded identical file.
tvImportJobSchema.index(
  {
    user: 1,
    source: 1,
    fileHash: 1,
  },
  {
    name: "user_source_import_file_hash",
    partialFilterExpression: {
      fileHash: {
        $type: "string",
      },
    },
  }
);

// Worker and administrative processing.
tvImportJobSchema.index({
  status: 1,
  createdAt: 1,
});

// Failed jobs eligible for manual or automated retries.
tvImportJobSchema.index({
  status: 1,
  attemptCount: 1,
  updatedAt: 1,
});

// ======================================================
// Validation and normalization
// ======================================================

tvImportJobSchema.pre(
  "validate",
  function normalizeTVImportJob(next) {
    try {
      const trimFields = [
        "originalFileName",
        "mimeType",
        "fileHash",
        "storageKey",
        "currentStage",
        "resumeFromStage",
        "errorCode",
        "errorMessage",
        "failedStage",
      ];

      for (const field of trimFields) {
        if (typeof this[field] === "string") {
          this[field] = this[field].trim();
        }
      }

      if (!this.fileHash) {
        this.fileHash = null;
      }

      const normalizeCount = (value) => {
        const number = Number(value);

        if (!Number.isFinite(number) || number < 0) {
          return 0;
        }

        return Math.floor(number);
      };

      this.fileSizeBytes = normalizeCount(
        this.fileSizeBytes
      );

      this.attemptCount = normalizeCount(
        this.attemptCount
      );

      this.importVersion = Math.max(
        1,
        normalizeCount(this.importVersion) || 1
      );

      this.progressPercentage = Math.max(
        0,
        Math.min(
          100,
          Number(this.progressPercentage) || 0
        )
      );

      if (this.stats) {
        for (const key of Object.keys(
          importStatsSchema.paths
        )) {
          if (key === "_id") {
            continue;
          }

          this.stats[key] = normalizeCount(
            this.stats[key]
          );
        }
      }

      if (Array.isArray(this.warnings)) {
        const groupedWarnings = new Map();

        for (const warning of this.warnings) {
          if (!warning) {
            continue;
          }

          const code =
            typeof warning.code === "string"
              ? warning.code.trim()
              : "";

          const message =
            typeof warning.message === "string"
              ? warning.message.trim()
              : "";

          if (!code && !message) {
            continue;
          }

          const key = `${code}:${message}`;
          const count = Math.max(
            1,
            normalizeCount(warning.count) || 1
          );

          const existing = groupedWarnings.get(key);

          if (existing) {
            existing.count += count;
          } else {
            groupedWarnings.set(key, {
              code,
              message,
              count,
            });
          }
        }

        // Keep only grouped summaries here.
        this.warnings = Array.from(
          groupedWarnings.values()
        ).slice(0, 100);
      }

      const now = new Date();

      if (
        this.status === "parsing" &&
        !this.parsingStartedAt
      ) {
        this.parsingStartedAt = now;
      }

      if (
        this.status === "preview_ready" &&
        !this.previewReadyAt
      ) {
        this.previewReadyAt = now;
      }

      if (
        this.status === "importing" &&
        !this.importingStartedAt
      ) {
        this.importingStartedAt = now;
      }

      if (
        [
          "completed",
          "completed_with_errors",
          "failed",
        ].includes(this.status) &&
        !this.completedAt
      ) {
        this.completedAt = now;
      }

      if (
        this.status === "cancelled" &&
        !this.cancelledAt
      ) {
        this.cancelledAt = now;
      }

      if (
        [
          "completed",
          "completed_with_errors",
        ].includes(this.status)
      ) {
        this.progressPercentage = 100;
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// Helpful virtuals
// ======================================================

tvImportJobSchema.virtual("isTerminal").get(
  function getIsTerminal() {
    return [
      "completed",
      "completed_with_errors",
      "failed",
      "cancelled",
    ].includes(this.status);
  }
);

tvImportJobSchema.virtual("isActive").get(
  function getIsActive() {
    return [
      "uploaded",
      "parsing",
      "preview_ready",
      "importing",
    ].includes(this.status);
  }
);

tvImportJobSchema.set("toJSON", {
  virtuals: true,
  transform(document, returnedObject) {
    delete returnedObject.storageKey;
    return returnedObject;
  },
});

tvImportJobSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.TVImportJob ||
  mongoose.model(
    "TVImportJob",
    tvImportJobSchema
  );

  
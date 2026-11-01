import SceneCommunityRatingPolygon from "../components/movieTabs/SceneCommunityRatingPolygon";
import SoundtrackTab from "../components/movieTabs/SoundtrackTab";
// src/screens/EpisodeScreen.js
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";

import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Linking,
  Alert,
  Animated,
} from "react-native";

import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";

import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import api from "../../../shared/api/api";
import useTranslate from "../../../shared/utils/useTranslate";
import { useLanguage } from "../../../shared/context/LanguageContext";

import StarRating from "../components/StarRating";
import ShowEpisodePickerModal from "../components/Show/ShowEpisodePickerModal";
import EpisodeTopBar from "../components/Episode/EpisodeTopBar";
import Text from "../../../shared/components/SceneText";

import { SCENE_ACCENT } from "../../../shared/utils/sceneAccent";

const { width: SCREEN_WIDTH } =
  Dimensions.get("window");

const FALLBACK_STILL =
  "https://scenesa.com/default-poster.jpg";

const FALLBACK_AVATAR =
  "https://scenesa.com/default-avatar.png";

const TMDB_PROFILE =
  "https://image.tmdb.org/t/p/w500";

const normalizeArray = (value) =>
  Array.isArray(value) ? value : [];

const getReviewId = (review) =>
  review?.id ||
  review?._id ||
  null;

const getReviewUserId = (review) =>
  review?.user?.id ||
  review?.user?._id ||
  null;

const formatDate = (
  value,
  language
) => {
  if (!value) return "";

  

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }

  try {
    return date.toLocaleDateString(
      language === "ar"
      ? "ar-SA-u-ca-gregory"
        : "en-US",
      {
        year: "numeric",
        month: "short",
        day: "numeric",
      }
    );
  } catch {
    return String(value).slice(0, 10);
  }
};

const getLikeCount = (review) =>
  Number(
    review?.engagement?.likeCount ??
      review?.likeCount ??
      review?.likes?.length ??
      0
  ) || 0;

const containsArabic = (value) =>
  /[\u0600-\u06FF]/.test(String(value || ""));

const getContentDirectionStyle = (value) =>
  containsArabic(value)
    ? {
        writingDirection: "rtl",
        textAlign: "right",
      }
    : {
        writingDirection: "ltr",
        textAlign: "left",
      };

const toArabicDigits = (value) =>
  String(value ?? "").replace(
    /\\d/g,
    (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]
  );

const formatEpisodeCode = (
  seasonNumber,
  episodeNumber,
  language
) => {
  if (language === "ar") {
    return `الموسم ${toArabicDigits(
      seasonNumber
    )} • الحلقة ${toArabicDigits(
      episodeNumber
    )}`;
  }

  return `S${String(seasonNumber).padStart(
    2,
    "0"
  )}E${String(episodeNumber).padStart(2, "0")}`;
};

const formatRuntime = (runtime, language) => {
  if (!runtime) return "";

  if (language === "ar") {
    return `${toArabicDigits(runtime)} د`;
  }

  return `${runtime}m`;
};


function SceneRatioMedia({ uri, style }) {
  const [ratio, setRatio] = useState(null);

  useEffect(() => {
    if (!uri) return;

    Image.getSize(
      uri,
      (width, height) => {
        setRatio(
          height
            ? width / height
            : 16 / 9
        );
      },
      () => {
        setRatio(16 / 9);
      }
    );
  }, [uri]);

  if (!uri) return null;

  return (
    <View style={styles.sceneRatioMediaWrap}>
      <Image
        source={{ uri }}
        resizeMode="contain"
        style={[
          styles.sceneRatioMedia,
          {
            aspectRatio:
              ratio || 16 / 9,
          },
          style,
        ]}
      />
    </View>
  );
}

export default function EpisodeScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const t = useTranslate();
  const { language } = useLanguage();

  /*
   * Scene stretchy episode backdrop.
   *
   * Negative scroll values happen when the user pulls
   * DOWN beyond the top of the screen.
   */
  const episodeScrollY =
    useRef(new Animated.Value(0)).current;

  const stretchyEpisodeBackdropScale =
    episodeScrollY.interpolate({
      inputRange: [-420, -260, -120, 0],
      outputRange: [2.6, 2.0, 1.45, 1],
      extrapolate: "clamp",
    });

  const stretchyEpisodeBackdropTranslateY =
    episodeScrollY.interpolate({
      inputRange: [-420, -260, -120, 0],
      outputRange: [-210, -130, -60, 0],
      extrapolate: "clamp",
    });

  const stretchyEpisodeBackdropBlurOpacity =
    episodeScrollY.interpolate({
      inputRange: [-320, -180, -60, 0],
      outputRange: [0.72, 0.40, 0.10, 0],
      extrapolate: "clamp",
    });

  const EXPO_TMDB_KEY =
    process.env.EXPO_PUBLIC_TMDB_API_KEY;

  const [arabicCastNames, setArabicCastNames] =
    useState({});

  const showTmdbId = Number(
    route.params?.showTmdbId
  );

  const seasonNumber = Number(
    route.params?.seasonNumber
  );

  const episodeNumber = Number(
    route.params?.episodeNumber
  );

  const [loading, setLoading] =
    useState(true);

  const [episode, setEpisode] =
    useState(null);

  // SCENE_114_TV_RATING_UI_V1: connect an authoritative backend summary here.
  const [sceneRatingSummary, setSceneRatingSummary] = useState(null);

  const [fullShow, setFullShow] =
    useState(null);

  const [latestLog, setLatestLog] =
    useState(null);

  const [myAvatar, setMyAvatar] =
    useState(FALLBACK_AVATAR);

  const [friendRatings, setFriendRatings] =
    useState([]);

  const [popularReviews, setPopularReviews] =
    useState([]);

  const [
    nextEpisodeDetails,
    setNextEpisodeDetails,
  ] = useState(null);

  const [
    loadingAdjacentEpisodes,
    setLoadingAdjacentEpisodes,
  ] = useState(false);

  const [showEpisodePicker, setShowEpisodePicker] =
    useState(false);

  const [revealedSpoilers, setRevealedSpoilers] =
    useState([]);

  const validRoute =
    Number.isInteger(showTmdbId) &&
    showTmdbId > 0 &&
    Number.isInteger(seasonNumber) &&
    seasonNumber >= 0 &&
    Number.isInteger(episodeNumber) &&
    episodeNumber > 0;

    const isArabicShow = useMemo(() => {
      const source =
        fullShow ||
        episode?.show ||
        {};
    
      return (
        String(
          source?.originalLanguage ||
            source?.original_language ||
            ""
        ).toLowerCase() === "ar"
      );
    }, [fullShow, episode?.show]);

  const loadEpisode = useCallback(
    async () => {
      if (!validRoute) {
        setLoading(false);
        setEpisode(null);
        return;
      }

      try {
        setLoading(true);

        /*
         * Episode logs do not always populate the current user's
         * profile information, so load the avatar independently.
         */
        try {
          const storedRaw =
            await AsyncStorage.getItem("user");

          const storedUser =
            storedRaw
              ? JSON.parse(storedRaw)
              : null;

          let currentAvatar =
            storedUser?.avatar ||
            FALLBACK_AVATAR;

          if (storedUser?._id) {
            try {
              const profileResult =
                await api.get(
                  `/api/users/${storedUser._id}`
                );

              currentAvatar =
                profileResult.data?.avatar ||
                currentAvatar;
            } catch {}
          }

          setMyAvatar(currentAvatar);
        } catch {
          setMyAvatar(FALLBACK_AVATAR);
        }

        const [
          episodeResult,
          showResult,
          latestResult,
          friendsResult,
          popularResult,
        ] = await Promise.allSettled([
          api.get(
            `/api/episodes/${showTmdbId}/${seasonNumber}/${episodeNumber}`,
            {
              params: {
                language:
                  language === "ar"
                    ? "ar-SA"
                    : "en-US",
              },
            }
          ),

          api.get(
            `/api/shows/${showTmdbId}`
          ),

          api.get(
            `/api/tv-logs/episode/${showTmdbId}/${seasonNumber}/${episodeNumber}/latest`
          ),

          api.get(
            `/api/tv-logs/episode/${showTmdbId}/${seasonNumber}/${episodeNumber}/friends`
          ),

          api.get(
            `/api/tv-logs/episode/${showTmdbId}/${seasonNumber}/${episodeNumber}/popular`,
            {
              params: {
                page: 1,
                limit: 3,
              },
            }
          ),
        ]);

        if (
          episodeResult.status !==
          "fulfilled"
        ) {
          throw episodeResult.reason;
        }

        setEpisode(
          episodeResult.value?.data ||
            null
        );

        setFullShow(
          showResult.status ===
            "fulfilled"
            ? showResult.value?.data ||
                null
            : null
        );

        setLatestLog(
          latestResult.status ===
            "fulfilled"
            ? latestResult.value?.data
                ?.log ||
                null
            : null
        );

        const friends =
          friendsResult.status ===
            "fulfilled" &&
          Array.isArray(
            friendsResult.value?.data
              ?.results
          )
            ? friendsResult.value.data
                .results
            : [];

        setFriendRatings(
          friends.filter(
            (item) =>
              typeof item?.rating ===
              "number"
          )
        );

        const popular =
          popularResult.status ===
            "fulfilled" &&
          Array.isArray(
            popularResult.value?.data
              ?.results
          )
            ? popularResult.value.data
                .results
            : [];

        setPopularReviews(popular);
      } catch (error) {
        console.error(
          "❌ Episode screen load failed:",
          error?.response?.data ||
            error?.message ||
            error
        );

        setEpisode(null);
      } finally {
        setLoading(false);
      }
    },
    [
      showTmdbId,
      seasonNumber,
      episodeNumber,
      validRoute,
      language,
    ]
  );

  useFocusEffect(
    useCallback(() => {
      loadEpisode();
    }, [loadEpisode])
  );

  useEffect(() => {
    setRevealedSpoilers([]);
  }, [
    showTmdbId,
    seasonNumber,
    episodeNumber,
  ]);

  useEffect(() => {
    let active = true;

    const loadNextEpisode = async () => {
      const navigationNext =
        episode?.navigation?.nextEpisode ||
        null;

      setNextEpisodeDetails(null);

      if (!episode || !showTmdbId) {
        setLoadingAdjacentEpisodes(false);
        return;
      }

      try {
        setLoadingAdjacentEpisodes(true);

        /*
         * First use the backend-provided next episode.
         * This handles normal episode-to-episode navigation
         * within the current season.
         */
        if (
          navigationNext?.seasonNumber != null &&
          navigationNext?.episodeNumber != null
        ) {
          try {
            const response = await api.get(
              `/api/episodes/${showTmdbId}/${navigationNext.seasonNumber}/${navigationNext.episodeNumber}`,
              {
                params: {
                  language:
                    language === "ar"
                      ? "ar-SA"
                      : "en-US",
                },
              }
            );

            if (!active) return;

            if (response?.data) {
              setNextEpisodeDetails(response.data);
              return;
            }
          } catch (error) {
            console.warn(
              "⚠️ Normal next episode lookup failed, trying next season:",
              error?.response?.data ||
                error?.message ||
                error
            );
          }
        }

        /*
         * Season-finale fallback.
         *
         * Some episode responses return nextEpisode: null
         * when the next chronological episode belongs to the
         * following season.
         *
         * Build a list of later seasons from the show payload,
         * then try Episode 1 of each until a valid episode is found.
         */
        const showSource =
          fullShow ||
          episode?.show ||
          {};

        const rawSeasons =
          Array.isArray(showSource?.seasons)
            ? showSource.seasons
            : [];

        const candidateSeasonNumbers = [
          ...new Set(
            rawSeasons
              .map((season) =>
                Number(
                  season?.seasonNumber ??
                    season?.season_number
                )
              )
              .filter(
                (number) =>
                  Number.isInteger(number) &&
                  number > seasonNumber
              )
          ),
        ].sort((a, b) => a - b);

        /*
         * Some show responses contain numberOfSeasons but not
         * a populated seasons array. Fill the candidates from it
         * as a second fallback.
         */
        const totalSeasons = Number(
          showSource?.numberOfSeasons ??
            showSource?.number_of_seasons ??
            0
        );

        if (
          Number.isInteger(totalSeasons) &&
          totalSeasons > seasonNumber
        ) {
          for (
            let number = seasonNumber + 1;
            number <= totalSeasons;
            number += 1
          ) {
            if (
              number > 0 &&
              !candidateSeasonNumbers.includes(number)
            ) {
              candidateSeasonNumbers.push(number);
            }
          }

          candidateSeasonNumbers.sort(
            (a, b) => a - b
          );
        }

        for (
          const nextSeasonNumber of candidateSeasonNumbers
        ) {
          try {
            const response = await api.get(
              `/api/episodes/${showTmdbId}/${nextSeasonNumber}/1`,
              {
                params: {
                  language:
                    language === "ar"
                      ? "ar-SA"
                      : "en-US",
                },
              }
            );

            if (!active) return;

            if (response?.data) {
              setNextEpisodeDetails(response.data);
              return;
            }
          } catch (error) {
            /*
             * If a season has no Episode 1 available,
             * continue to the next candidate season.
             */
          }
        }

        if (active) {
          setNextEpisodeDetails(null);
        }
      } catch (error) {
        if (!active) return;

        console.error(
          "❌ Failed to load next episode:",
          error?.response?.data ||
            error?.message ||
            error
        );

        setNextEpisodeDetails(null);
      } finally {
        if (active) {
          setLoadingAdjacentEpisodes(false);
        }
      }
    };

    loadNextEpisode();

    return () => {
      active = false;
    };
  }, [
    episode,
    fullShow,
    showTmdbId,
    seasonNumber,
    language,
  ]);

  const title = useMemo(() => {
    if (!episode) return "";
  
    if (isArabicShow) {
      return (
        episode.nameAr ||
        episode.name ||
        episode.nameEn ||
        t("Untitled Episode")
      );
    }
  
    return (
      episode.nameEn ||
      episode.name ||
      t("Untitled Episode")
    );
  }, [episode, isArabicShow, t]);

  const overview = useMemo(() => {
    if (!episode) return "";

    if (language === "ar") {
      return (
        episode.overviewAr ||
        episode.overviewEn ||
        episode.overview ||
        ""
      );
    }

    return (
      episode.overviewEn ||
      episode.overview ||
      episode.overviewAr ||
      ""
    );
  }, [episode, language]);

  const showTitle = useMemo(() => {
    const source =
      fullShow ||
      episode?.show;
  
    if (!source) return "";
  
    if (isArabicShow) {
      return (
        source.nameAr ||
        source.originalName ||
        source.nameEn ||
        source.name ||
        t("Untitled Show")
      );
    }
  
    return (
      source.nameEn ||
      source.name ||
      source.originalName ||
      t("Untitled Show")
    );
  }, [fullShow, episode?.show, isArabicShow, t]);

  const directors = normalizeArray(
    episode?.directors
  );

  const writers = normalizeArray(
    episode?.writers
  );

  const [showAllCast, setShowAllCast] =
  useState(false);

const allCast = useMemo(
  () => normalizeArray(episode?.cast),
  [episode?.cast]
);

const visibleCast = useMemo(
  () =>
    showAllCast
      ? allCast.slice(0, 27)
      : allCast.slice(0, 6),
  [allCast, showAllCast]
);

useEffect(() => {
  let active = true;

  const loadArabicCastNames = async () => {
    if (
      language !== "ar" ||
      !EXPO_TMDB_KEY ||
      !visibleCast.length
    ) {
      if (active) {
        setArabicCastNames({});
      }
      return;
    }

    try {
      const entries = await Promise.all(
        visibleCast.map(async (actor) => {
          const personId = Number(actor?.id);

          if (!Number.isFinite(personId)) {
            return null;
          }

          try {
            const cacheKey =
              `episodeCastNameAr:${personId}`;

            const cached =
              await AsyncStorage.getItem(cacheKey);

            if (cached) {
              return [personId, cached];
            }

            const response = await fetch(
              `https://api.themoviedb.org/3/person/${personId}?api_key=${EXPO_TMDB_KEY}&language=ar-SA`
            );

            if (!response.ok) {
              return null;
            }

            const data = await response.json();

            const arabicName =
              data?.name &&
              containsArabic(data.name)
                ? data.name
                : null;

            if (!arabicName) {
              return null;
            }

            try {
              await AsyncStorage.setItem(
                cacheKey,
                arabicName
              );
            } catch {}

            return [personId, arabicName];
          } catch {
            return null;
          }
        })
      );

      if (!active) return;

      const nextNames = {};

      for (const entry of entries) {
        if (!entry) continue;

        const [personId, arabicName] = entry;
        nextNames[personId] = arabicName;
      }

      setArabicCastNames(nextNames);
    } catch {
      if (active) {
        setArabicCastNames({});
      }
    }
  };

  loadArabicCastNames();

  return () => {
    active = false;
  };
}, [
  language,
  visibleCast,
  EXPO_TMDB_KEY,
]);

  const backdrop =
    latestLog?.customEpisodeBackdrop ||
    episode?.viewer?.customBackdrop ||
    episode?.still ||
    episode?.show?.backdrop ||
    FALLBACK_STILL;

  const openEpisode = (
    nextSeasonNumber,
    nextEpisodeNumber
  ) => {
    navigation.replace("Episode", {
      showTmdbId,
      seasonNumber:
        Number(nextSeasonNumber),
      episodeNumber:
        Number(nextEpisodeNumber),
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
          color={SCENE_ACCENT}
        />

        <Text style={styles.loadingText}>
          {t("Loading episode...")}
        </Text>
      </View>
    );
  }

  if (!episode) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>
          {t("Episode not found.")}
        </Text>

        <TouchableOpacity
          style={styles.backFallback}
          onPress={() =>
            navigation.goBack()
          }
        >
          <Text style={styles.backFallbackText}>
            {t("Go Back")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <EpisodeTopBar
        episode={episode}
        onHistoryDeleted={loadEpisode}
      />

      <Animated.ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        bounces
        alwaysBounceVertical
        onScroll={Animated.event(
          [
            {
              nativeEvent: {
                contentOffset: {
                  y: episodeScrollY,
                },
              },
            },
          ],
          {
            useNativeDriver: true,
          },
        )}
      >
        <View style={styles.backdropWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.episodeStretchBackdropLayer,
              {
                transform: [
                  {
                    translateY:
                      stretchyEpisodeBackdropTranslateY,
                  },
                  {
                    scale:
                      stretchyEpisodeBackdropScale,
                  },
                ],
              },
            ]}
          >
            <Image
              source={{ uri: backdrop }}
              style={styles.backdrop}
              resizeMode="cover"
            />

            {/* Same episode artwork, progressively blurred */}
            <Animated.Image
              source={{ uri: backdrop }}
              style={[
                styles.episodeBackdropBlurLayer,
                {
                  opacity:
                    stretchyEpisodeBackdropBlurOpacity,
                },
              ]}
              resizeMode="cover"
              blurRadius={14}
            />

            {/* Soft cinematic darkening on deep pull */}
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                styles.episodeBackdropPullShade,
                {
                  opacity:
                    stretchyEpisodeBackdropBlurOpacity,
                },
              ]}
            />
          </Animated.View>

          <LinearGradient
            colors={[
              "rgba(14,14,14,0)",
              "rgba(14,14,14,0.55)",
              "#0e0e0e",
            ]}
            style={
              StyleSheet.absoluteFillObject
            }
          />

          <View style={styles.heroContent}>
            <View style={styles.heroText}>
              <Text
                style={styles.title}
              >
                {title}
              </Text>

              <View style={styles.episodeMetaRow}>
                <Text
                  classic
                  style={styles.episodeMetaPiece}
                >
                  {formatEpisodeCode(
                    episode.seasonNumber ??
                      seasonNumber,
                    episode.episodeNumber ??
                      episodeNumber,
                    language
                  )}
                </Text>

                {!!episode.runtime && (
                  <>
                    <Text
                      classic
                      style={styles.episodeMetaSeparator}
                    >
                      •
                    </Text>

                    <Text
                      style={styles.episodeMetaPiece}
                    >
                      {formatRuntime(
                        episode.runtime,
                        language
                      )}
                    </Text>
                  </>
                )}

                {!!episode.airDate && (
                  <>
                    <Text
                      classic
                      style={styles.episodeMetaSeparator}
                    >
                      •
                    </Text>

                    <Text
                      style={styles.episodeMetaDate}
                    >
                      {formatDate(
                        episode.airDate,
                        language
                      )}
                    </Text>
                  </>
                )}
              </View>

              <TouchableOpacity
                onPress={() =>
                  navigation.navigate(
                    "Show",
                    {
                      id: showTmdbId,
                      showTmdbId,
                    }
                  )
                }
              >
                <Text
                  style={styles.showName}
                >
                  {showTitle}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.heroButtons}>
  <TouchableOpacity
    style={styles.heroButton}
    onPress={() =>
      navigation.navigate("Show", {
        id: showTmdbId,
        showTmdbId,
      })
    }
  >
    <Text style={styles.heroButtonText}>
      {t("Go to Show")}
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={styles.heroButton}
    onPress={() =>
      navigation.navigate("EpisodeLog", {
        showTmdbId,
        seasonNumber,
        episodeNumber,
        episode,
      })
    }
  >
    <Text style={styles.heroButtonText}>
      + {t("Log Episode")}
    </Text>
  </TouchableOpacity>
</View>

          </View>
        </View>

        <View style={styles.section}>
          <SoundtrackTab
            title={episode?.name}
            showTitle={showTitle}
            type="episode"
            seasonNumber={seasonNumber}
            episodeNumber={episodeNumber}
            hideWhenMissing
          />
        </View>

        {!!overview && (
          <View style={styles.section}>
            <View style={styles.headerRow}>
              <Text style={styles.sectionTitle}>
                {t("Overview")}
              </Text>

              {episode.voteAverage > 0 && (
                <View style={styles.tmdbRating}>
                  <StarRating
                    rating={
                      episode.voteAverage
                    }
                    size={12}
                  />

                  <Text style={styles.subtle}>
                    {Number(
                      episode.voteAverage
                    ).toFixed(1)}
                  </Text>
                </View>
              )}
            </View>

            <Text
              classic={!containsArabic(overview)}
              style={[
                styles.overview,
                getContentDirectionStyle(overview),
              ]}
            >
              {overview}
            </Text>
          </View>
        )}

        <SceneCommunityRatingPolygon summary={sceneRatingSummary} />

        <View style={styles.section}>

        <View style={styles.headerRow}>
  <Text style={styles.sectionTitle}>
    {t("Episodes")}
  </Text>

  <TouchableOpacity
    onPress={() =>
      setShowEpisodePicker(true)
    }
    activeOpacity={0.8}
  >
    <Text style={styles.moreText}>
      {language === "ar"
        ? `← ${t("Season")} ${seasonNumber}`
        : `${episode.season?.nameEn ||
            `${t("Season")} ${seasonNumber}`} →`}
    </Text>
  </TouchableOpacity>
</View>

          {loadingAdjacentEpisodes ? (
            <View
              style={
                styles.adjacentEpisodesLoading
              }
            >
              <ActivityIndicator
                size="small"
                color={SCENE_ACCENT}
              />
            </View>
          ) : nextEpisodeDetails ? (
            <TouchableOpacity
              style={
                styles.nextEpisodeCard
              }
              activeOpacity={0.86}
              onPress={() =>
                openEpisode(
                  nextEpisodeDetails
                    .seasonNumber,
                  nextEpisodeDetails
                    .episodeNumber
                )
              }
            >
              <Image
                source={{
                  uri:
                    nextEpisodeDetails
                      .still ||
                    nextEpisodeDetails
                      .show?.backdrop ||
                    FALLBACK_STILL,
                }}
                style={
                  styles.adjacentEpisodeImage
                }
                resizeMode="cover"
              />

              <LinearGradient
                colors={[
                  "rgba(0,0,0,0)",
                  "rgba(0,0,0,0.88)",
                ]}
                style={
                  styles.adjacentEpisodeGradient
                }
              />

              <View
                style={[
                  styles.adjacentEpisodeContent,
                  language === "ar" &&
                    styles.adjacentEpisodeContentArabic,
                ]}
              >
                <View
                  style={
                    styles.nextEpisodeLabelRow
                  }
                >
                  <Text
                    style={
                      styles.adjacentEpisodeDirectionText
                    }
                  >
                    {t("Next Episode")}
                  </Text>

                  <Ionicons
                    name={
                      language === "ar"
                        ? "chevron-back"
                        : "chevron-forward"
                    }
                    size={14}
                    color="#aaa"
                  />
                </View>

                <Text
                  style={[
                    styles.adjacentEpisodeTitle,
                    getContentDirectionStyle(
                      isArabicShow
                        ? (
                            nextEpisodeDetails.nameAr ||
                            nextEpisodeDetails.name ||
                            nextEpisodeDetails.nameEn ||
                            ""
                          )
                        : (
                            nextEpisodeDetails.nameEn ||
                            nextEpisodeDetails.name ||
                            ""
                          )
                    ),
                  ]}
                  numberOfLines={2}
                >
                  {isArabicShow
  ? (
      nextEpisodeDetails.nameAr ||
      nextEpisodeDetails.name ||
      nextEpisodeDetails.nameEn ||
      t("Untitled Episode")
    )
  : (
      nextEpisodeDetails.nameEn ||
      nextEpisodeDetails.name ||
      t("Untitled Episode")
    )}
                </Text>

                <Text
                  classic
                  style={[
                    styles.adjacentEpisodeMeta,
                    styles.episodeMetaLTR,
                  ]}
                  numberOfLines={1}
                >
                  {formatEpisodeCode(
                    nextEpisodeDetails.seasonNumber,
                    nextEpisodeDetails.episodeNumber,
                    language
                  )}
                  {nextEpisodeDetails.airDate
                    ? ` • ${formatDate(
                        nextEpisodeDetails
                          .airDate,
                        language
                      )}`
                    : ""}
                </Text>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={styles.subtle}>
              {t("No next episode found.")}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>
              {t("Friends Ratings")}
            </Text>

            {friendRatings.length > 4 && (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate(
                    "EpisodeReviews",
                    {
                      showTmdbId,
                      seasonNumber,
                      episodeNumber,
                      initialFilter:
                        "friends",
                      title,
                      showTitle,
                    }
                  )
                }
                activeOpacity={0.8}
              >
                <Text style={styles.moreText}>
                  {t("More")} →
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.ratingsRow}>
            {/* Current user's rating */}
            <View style={styles.myRatingColumn}>
              <Text style={styles.myRatingLabel}>
                {t("You")}
              </Text>

              <TouchableOpacity
                style={styles.ratingPerson}
                disabled={!latestLog}
                activeOpacity={0.85}
                onPress={() => {
                  const logId =
                    getReviewId(latestLog);

                  if (!logId) return;

                  navigation.navigate(
                    "EpisodeReview",
                    {
                      logId,
                    }
                  );
                }}
              >
                <Image
                  source={{
                    uri:
                      latestLog?.user
                        ?.avatar ||
                      latestLog?.userAvatar ||
                      latestLog?.avatar ||
                      myAvatar ||
                      FALLBACK_AVATAR,
                  }}
                  style={[
                    styles.ratingAvatar,
                    styles.myRatingAvatar,
                  ]}
                />

                {typeof latestLog?.rating ===
                "number" ? (
                  <>
                    <StarRating
                      rating={
                        Number(
                          latestLog.rating
                        ) || 0
                      }
                      size={10}
                    />

                    {!!latestLog.teamTag && (
                      <Text
                        style={
                          styles.ratingTeamTag
                        }
                        numberOfLines={1}
                      >
                        {latestLog.teamTag}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text
                    style={
                      styles.noRatingText
                    }
                  >
                    {t("Not rated")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View
              style={styles.ratingDivider}
            />

            {/* Four friends */}
            <View
              style={
                styles.friendRatingsRow
              }
            >
              {friendRatings.length === 0 ? (
                <Text
                  style={
                    styles.noFriendRatings
                  }
                >
                  {t(
                    "No friends have rated this episode yet."
                  )}
                </Text>
              ) : (
                friendRatings
                  .slice(0, 4)
                  .map((review) => {
                    const reviewId =
                      getReviewId(review);

                    const userId =
                      getReviewUserId(
                        review
                      );

                    return (
                      <TouchableOpacity
                        key={
                          reviewId ||
                          userId
                        }
                        style={
                          styles.ratingPerson
                        }
                        activeOpacity={0.85}
                        onPress={() => {
                          if (!reviewId) {
                            return;
                          }

                          navigation.navigate(
                            "EpisodeReview",
                            {
                              logId:
                                reviewId,
                            }
                          );
                        }}
                      >
                        <Image
                          source={{
                            uri:
                              review?.user
                                ?.avatar ||
                              FALLBACK_AVATAR,
                          }}
                          style={
                            styles.ratingAvatar
                          }
                        />

                        <StarRating
                          rating={
                            Number(
                              review.rating
                            ) || 0
                          }
                          size={10}
                        />

                        {!!review.teamTag && (
                          <Text
                            style={
                              styles.ratingTeamTag
                            }
                            numberOfLines={1}
                          >
                            {review.teamTag}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })
              )}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>
              {t("Popular Reviews")}
            </Text>

            <TouchableOpacity
              onPress={() =>
                navigation.navigate(
                  "EpisodeReviews",
                  {
                    showTmdbId,
                    seasonNumber,
                    episodeNumber,
                    initialFilter: "all",
                    title,
                    showTitle,
                  }
                )
              }
            >
              <Text style={styles.moreText}>
                {t("More")} →
              </Text>
            </TouchableOpacity>
          </View>

          {!popularReviews.length ? (
            <Text style={styles.subtle}>
              {t(
                "No episode reviews yet."
              )}
            </Text>
          ) : (
            popularReviews.map((review) => {
              const reviewId =
                getReviewId(review);

              const hidden =
                review.containsSpoilers &&
                !revealedSpoilers.includes(
                  reviewId
                );

              return (
                <TouchableOpacity
                  key={String(reviewId)}
                  style={styles.reviewCard}
                  activeOpacity={0.88}
                  onPress={() => {
                    if (hidden) {
                      setRevealedSpoilers(
                        (current) => [
                          ...current,
                          reviewId,
                        ]
                      );

                      return;
                    }

                    navigation.navigate(
                      "EpisodeReview",
                      {
                        logId: reviewId,
                      }
                    );
                  }}
                >
                  <View style={styles.reviewHeader}>
                    <Image
                      source={{
                        uri:
                          review?.user
                            ?.avatar ||
                          FALLBACK_AVATAR,
                      }}
                      style={
                        styles.reviewAvatar
                      }
                    />

                    <View style={{ flex: 1 }}>
                      <View style={styles.reviewUserRow}>
                        <Text style={styles.reviewUsername}>
                          @{review?.user?.username ||
                            "user"}
                        </Text>

                        {typeof review.rating ===
                          "number" && (
                          <StarRating
                            rating={
                              review.rating
                            }
                            size={11}
                          />
                        )}

                        {!!review.teamTag && (
                          <Text style={styles.teamTagInline}>
                            {review.teamTag}
                          </Text>
                        )}
                      </View>

                      {hidden ? (
                        <View style={styles.spoilerBox}>
                          <Ionicons
                            name="eye-off-outline"
                            size={17}
                            color="#aaa"
                          />

                          <Text style={styles.spoilerText}>
                            {t(
                              "This review contains spoilers. Tap to reveal."
                            )}
                          </Text>
                        </View>
                      ) : (
                        <>
                          {!!review.review && (
                            <Text classic
                              style={styles.reviewText}
                              numberOfLines={4}
                            >
                              {review.review}
                            </Text>
                          )}

                          {!!review.media?.gif && (
                            <SceneRatioMedia
                              uri={review.media.gif}
                            />
                          )}

                          {!!review.media?.image && (
                            <SceneRatioMedia
                              uri={review.media.image}
                            />
                          )}
                        </>
                      )}

                      <View style={styles.reviewFooter}>
                        <Ionicons
                          name="heart-outline"
                          size={15}
                          color="#888"
                        />

                        <Text style={styles.subtle}>
                          {getLikeCount(review)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {!!directors.length && (
          <View style={styles.section}>
            {directors.map((person) => (
              <TouchableOpacity
                key={`${person.id}-${person.creditId}`}
                style={styles.personRow}
                onPress={() =>
                  navigation.navigate(
                    "Director",
                    {
                      id: person.id,
                    }
                  )
                }
              >
                <Image
                  source={{
                    uri:
                      person.profile ||
                      FALLBACK_AVATAR,
                  }}
                  style={styles.personAvatar}
                />

                <View>
                  <Text style={styles.personName}>
                    {person.name}
                  </Text>

                  <Text style={styles.personRole}>
                    {person.job ||
                      t("Director")}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!!writers.length && (
          <View
            style={[
              styles.section,
              styles.writerSection,
            ]}
          >
            {writers.slice(0, 3).map(
              (person) => (
                <View
                  key={`${person.id}-${person.creditId}`}
                  style={styles.personRow}
                >
                  <Image
                    source={{
                      uri:
                        person.profile ||
                        FALLBACK_AVATAR,
                    }}
                    style={styles.personAvatar}
                  />

                  <View>
                    <Text style={styles.personName}>
                      {person.name}
                    </Text>

                    <Text style={styles.personRole}>
                      {person.job ||
                        t("Writer")}
                    </Text>
                  </View>
                </View>
              )
            )}
          </View>
        )}

{!!visibleCast.length && (
          <View style={styles.section}>
            <View style={styles.headerRow}>
  <Text style={styles.sectionTitle}>
    {t("Starring")}
  </Text>

  {allCast.length > 6 && (
    <TouchableOpacity
      onPress={() =>
        setShowAllCast(
          (current) => !current
        )
      }
      activeOpacity={0.8}
    >
      <Text style={styles.moreText}>
        {showAllCast
          ? t("Show Less")
          : t("More")}
      </Text>
    </TouchableOpacity>
  )}
</View>

            <View style={styles.castGrid}>
            {visibleCast.map((actor) => {
                const width =
                  (SCREEN_WIDTH -
                    32 -
                    20) /
                  3;

                return (
                  <TouchableOpacity
                    key={`${actor.id}-${actor.creditId}`}
                    style={{
                      width,
                      alignItems:
                        "center",
                      marginBottom: 14,
                    }}
                    onPress={() =>
                      navigation.navigate(
                        "Actor",
                        {
                          id: actor.id,
                        }
                      )
                    }
                  >
                    <Image
                      source={{
                        uri:
                          actor.profile ||
                          (actor.profilePath
                            ? `${TMDB_PROFILE}${actor.profilePath}`
                            : FALLBACK_AVATAR),
                      }}
                      style={{
                        width,
                        height:
                          Math.round(
                            width * 1.5
                          ),
                        borderRadius: 10,
                        backgroundColor:
                          "#222",
                      }}
                    />

                    <Text
                      style={styles.castCharacter}
                      numberOfLines={2}
                    >
                      {actor.character}
                    </Text>

                    <Text
                      style={styles.castName}
                      numberOfLines={2}
                    >
                      {actor.nameEn ||
                        actor.name ||
                        t("Unknown")}
                    </Text>

                    {(() => {
                      const personId = Number(
                        actor?.id ??
                          actor?.actorId
                      );

                      const arabicName =
                        arabicCastNames?.[personId] ||
                        actor?.nameAr ||
                        actor?.actorNameAr ||
                        actor?.arabicName ||
                        actor?.nameArabic ||
                        "";

                      const englishName =
                        actor.nameEn ||
                        actor.name ||
                        "";

                      if (
                        !arabicName ||
                        !containsArabic(arabicName) ||
                        arabicName === englishName
                      ) {
                        return null;
                      }

                      return (
                        <Text
                          style={[
                            styles.castName,
                            styles.castNameArabic,
                          ]}
                          numberOfLines={2}
                        >
                          {arabicName}
                        </Text>
                      );
                    })()}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </Animated.ScrollView>

      <ShowEpisodePickerModal
        visible={showEpisodePicker}
        show={
          fullShow || {
            ...episode.show,
            seasons: [],
          }
        }
        showTmdbId={showTmdbId}
        initialSeasonNumber={
          seasonNumber
        }
        onClose={() =>
          setShowEpisodePicker(false)
        }
        onProgressChanged={
          loadEpisode
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0e0e0e",
  },

  centered: {
    flex: 1,
    backgroundColor: "#0e0e0e",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  loadingText: {
    color: "#fff",
    marginTop: 12,
  },

  backFallback: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },

  backFallbackText: {
    color: "#fff",
  },

  scrollContent: {
    paddingBottom: 120,
  },

  backdropWrap: {
    width: "100%",
    height: 260,
    backgroundColor: "#111",
    overflow: "visible",
  },

  episodeStretchBackdropLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "visible",
  },

  episodeBackdropBlurLayer: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  episodeBackdropPullShade: {
    backgroundColor: "#000",
  },

  backdrop: {
    width: "100%",
    height: "100%",
  },

  heroContent: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: -22,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },

  heroText: {
    flex: 1,
  },

  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    fontFamily: "PixelifySans_700Bold",
    writingDirection: "natural",
    textAlign: "left",
  },

  episodeMeta: {
    color: "#ccc",
    fontSize: 11.5,
    marginTop: 5,
  },

  episodeMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    direction: "ltr",
  },

  episodeMetaPiece: {
    color: "#ccc",
    fontSize: 11.5,
    writingDirection: "ltr",
  },

  episodeMetaSeparator: {
    color: "#777",
    fontSize: 11.5,
    writingDirection: "ltr",
  },

  episodeMetaDate: {
    color: "#ccc",
    fontSize: 11.5,
  },

  episodeMetaLTR: {
    writingDirection: "ltr",
    textAlign: "left",
  },

  showName: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "400",
    marginTop: 5,
    writingDirection: "natural",
    textAlign: "left",
  },

  heroButtons: {
    width: 118,
    gap: 8,
  },
  
  heroButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 34,
    borderRadius: 8,
  
    backgroundColor: "rgba(0,0,0,0.25)",
    borderColor: "rgba(255,255,255,0.15)",

    borderColor: "rgba(255,255,255,0.18)",
  
    alignItems: "center",
    justifyContent: "center",
  },
  
  flexHeroButton: {
    width: "100%",
  },
  
  heroButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },

  section: {
    paddingHorizontal: 16,
    marginTop: 44,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },

  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  


  overview: {
    color: "#ddd",
    fontSize: 14.5,
    lineHeight: 21,
  },

  subtle: {
    color: "#888",
    fontSize: 12,
  },

  tmdbRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    top: -5,
  },

  moreText: {
    color: "#aaa",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },

  adjacentEpisodesLoading: {
    height: 135,
    alignItems: "center",
    justifyContent: "center",
  },

  nextEpisodeCard: {
    width: "100%",
    height: 205,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#171717",
    borderWidth: 1,
    borderColor: "#292929",
  },

  adjacentEpisodeImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#222",
  },

  adjacentEpisodeGradient: {
    ...StyleSheet.absoluteFillObject,
  },

  adjacentEpisodeContent: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
  },

  adjacentEpisodeContentArabic: {
    alignItems: "stretch",
  },

  nextEpisodeLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
    marginBottom: 5,
  },

  adjacentEpisodeDirectionText: {
    color: "#aaa",
    fontSize: 9.5,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  adjacentEpisodeTitle: {
    color: "#fff",
    fontSize: 12.5,
    fontWeight: "800",
    lineHeight: 16,
  },

  adjacentEpisodeMeta: {
    color: "#aaa",
    fontSize: 9.5,
    fontWeight: "600",
    marginTop: 4,
  },

  ratingsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 8,
  },

  myRatingColumn: {
    width: 67,
    alignItems: "center",
  },

  myRatingLabel: {
    color: SCENE_ACCENT,
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 7,
    textTransform: "uppercase",
  },

  ratingDivider: {
    width: 1,
    minHeight: 92,
    backgroundColor: "#292929",
    marginHorizontal: 10,
  },

  friendRatingsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    top:19
  },

  ratingPerson: {
    width: 57,
    alignItems: "center",
  },

  ratingAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#222",
    marginBottom: 6,
  },

  myRatingAvatar: {
    borderWidth: 1,
    borderColor: SCENE_ACCENT,
  },

  ratingTeamTag: {
    color: SCENE_ACCENT,
    fontSize: 8.5,
    fontWeight: "700",
    marginTop: 4,
    maxWidth: 58,
    textAlign: "center",
  },

  noRatingText: {
    color: "#777",
    fontSize: 9,
    marginTop: 2,
    textAlign: "center",
  },

  noFriendRatings: {
    flex: 1,
    color: "#777",
    fontSize: 12,
    paddingTop: 28,
  },

  reviewCard: {
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    paddingVertical: 12,
  },

  reviewHeader: {
    flexDirection: "row",
    gap: 10,
  },

  reviewAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#222",
  },

  reviewUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },

  reviewUsername: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "800",
  },

  teamTagInline: {
    color: SCENE_ACCENT,
    fontSize: 10,
    fontWeight: "800",
  },

  reviewText: {
    color: "#ddd",
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 5,
  },

  reviewMedia: {
    width: "100%",
  },

  sceneRatioMediaWrap: {
    marginTop: 8,
    width: "100%",
    backgroundColor: "#000",
    borderRadius: 10,
    overflow: "hidden",
  },

  sceneRatioMedia: {
    width: "100%",
  },

  reviewFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },

  spoilerBox: {
    minHeight: 75,
    borderRadius: 10,
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#282828",
    marginTop: 7,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },

  spoilerText: {
    color: "#aaa",
    fontSize: 11,
    textAlign: "center",
    marginTop: 5,
  },

  personRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#222",
    padding: 8,
    gap: 10,
    marginBottom: 6,
  },

  personAvatar: {
    width: 48,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#222",
  },

  personName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },

  personRole: {
    color: "#b5b5b5",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },

  writerSection: {
    marginTop: 8,
  },

  castGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 3,
  },

  castName: {
    color: "#ddd",
    fontSize: 10.5,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },

  castNameArabic: {
    color: "#888",
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 1,
  },

  castCharacter: {
    color: "#fff",
    fontSize: 10.5,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 6,
  },
});

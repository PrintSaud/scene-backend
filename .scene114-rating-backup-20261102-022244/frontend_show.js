import SceneCommunityRatingPolygon from "../components/movieTabs/SceneCommunityRatingPolygon";
import SoundtrackTab from "../components/movieTabs/SoundtrackTab";
// src/screens/ShowScreen.js

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Alert,
  Dimensions,
  Animated,
  Easing,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";

import api from "../../../shared/api/api";
import useTranslate from "../../../shared/utils/useTranslate";
import { useLanguage } from "../../../shared/context/LanguageContext";

import StarRating from "../components/StarRating";
import ShowEpisodePickerModal from "../components/Show/ShowEpisodePickerModal";
import ShowTopBar from "../components/Show/ShowTopBar";
import Text from "../../../shared/components/SceneText";

import { SCENE_ACCENT } from "../../../shared/utils/sceneAccent";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const FALLBACK_POSTER = "https://scenesa.com/default-poster.jpg";

const FALLBACK_AVATAR = "https://scenesa.com/default-avatar.png";

const TMDB_POSTER = "https://image.tmdb.org/t/p/w500";

const TMDB_PROFILE = "https://image.tmdb.org/t/p/w500";

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const containsArabic = (value) =>
  /[\u0600-\u06FF]/.test(
    String(value || "")
  );

const isSaudiShow = (show) => {
  if (!show) return false;

  const productionCountries =
    show.productionCountries ||
    show.production_countries ||
    [];

  const productionCompanies =
    show.productionCompanies ||
    show.production_companies ||
    [];

  const originCountries =
    show.originCountry ||
    show.origin_country ||
    [];

  return (
    normalizeArray(productionCountries).some((country) => {
      const code =
        country?.iso_3166_1 ||
        country?.isoCode ||
        country?.code ||
        country;

      return String(code || "").toUpperCase() === "SA";
    }) ||
    normalizeArray(productionCompanies).some((company) =>
      String(
        company?.origin_country ||
        company?.originCountry ||
        ""
      ).toUpperCase() === "SA"
    ) ||
    normalizeArray(originCountries).some(
      (country) =>
        String(country || "").toUpperCase() === "SA"
    )
  );
};

const clampPercent = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  return Math.max(0, Math.min(100, Math.round(number)));
};

const getUserId = (user) => String(user?._id || user?.id || user || "");

const getProgressPercent = (progress) =>
  clampPercent(
    progress?.progressPercentage ??
      progress?.completionPercent ??
      progress?.progressPercent ??
      progress?.percent ??
      progress?.percentage ??
      0,
  );

const getWatchedCount = (progress) =>
  Number(
    progress?.watchedEpisodeCount ??
      progress?.watchedEpisodesCount ??
      progress?.watchedCount ??
      0,
  ) || 0;

const getTotalCount = (progress, show) =>
  Number(
    show?.numberOfEpisodes ??
      progress?.totalEpisodeCount ??
      progress?.totalEpisodesCount ??
      progress?.airedEpisodeCount ??
      0,
  ) || 0;

const getSeasonNumber = (season) => {
  const number = season?.seasonNumber ?? season?.season_number;

  const parsed = Number(number);

  return Number.isInteger(parsed) ? parsed : null;
};

const getSeasonPoster = (season) => {
  if (season?.poster) return season.poster;

  if (season?.posterPath) {
    return `${TMDB_POSTER}${season.posterPath}`;
  }

  return FALLBACK_POSTER;
};

const getReviewId = (review) => review?.id || review?._id || null;

const getReviewUserId = (review) =>
  review?.user?.id || review?.user?._id || null;

const getShowReviewLikeCount = (review) =>
  Number(
    review?.engagement?.likeCount ??
      review?.likeCount ??
      review?.likes?.length ??
      0,
  ) || 0;

const getShowReviewReplyCount = (review) =>
  Number(
    review?.engagement?.replyCount ??
      review?.replyCount ??
      review?.replies?.length ??
      0,
  ) || 0;

const getShowReviewMedia = (review) => ({
  gif: review?.media?.gif || review?.gif || "",

  image: review?.media?.image || review?.image || "",
});

const hasShowReviewContent = (review) => {
  const text = String(review?.review || "").trim();

  const media = getShowReviewMedia(review);

  const hasText =
    Boolean(text) &&
    text !== "__media__" &&
    text !== "[GIF ONLY]" &&
    text !== "[IMAGE ONLY]";

  const hasMedia =
    Boolean(media.gif || media.image);

  return hasText || hasMedia;
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

export default function ShowScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const rawId = route.params?.showTmdbId ?? route.params?.id;

  const showTmdbId = Number(rawId);

  const t = useTranslate();
  const { language } = useLanguage();

  const isArabicUI =
    String(language || "").toLowerCase() === "ar" ||
    String(language || "").toLowerCase() === "arabic" ||
    String(language || "").toLowerCase().startsWith("ar-") ||
    String(language || "").toLowerCase().startsWith("ar_");

  const scrollRef = useRef(null);
  const seasonsYRef = useRef(0);

  /*
   * Scene stretchy show backdrop.
   */
  const showScrollY =
    useRef(new Animated.Value(0)).current;

  const stretchyShowBackdropScale =
    showScrollY.interpolate({
      inputRange: [-420, -260, -120, 0],
      outputRange: [2.6, 2.0, 1.45, 1],
      extrapolate: "clamp",
    });

  const stretchyShowBackdropTranslateY =
    showScrollY.interpolate({
      inputRange: [-420, -260, -120, 0],
      outputRange: [-210, -130, -60, 0],
      extrapolate: "clamp",
    });

  const stretchyShowBackdropBlurOpacity =
    showScrollY.interpolate({
      inputRange: [-320, -180, -60, 0],
      outputRange: [0.72, 0.40, 0.10, 0],
      extrapolate: "clamp",
    });

  const EXPO_TMDB_KEY =
    process.env.EXPO_PUBLIC_TMDB_API_KEY;

  const saudiGlow =
    useRef(new Animated.Value(0)).current;

  const [myShowReview, setMyShowReview] = useState(null);

  const [myAvatar, setMyAvatar] = useState(FALLBACK_AVATAR);

  const [friendShowReviews, setFriendShowReviews] = useState([]);

  const [loadingShowRatings, setLoadingShowRatings] = useState(true);

  const [showRatingsModal, setShowRatingsModal] = useState(false);

  const [popularShowReviews, setPopularShowReviews] = useState([]);

  const [loadingPopularReviews, setLoadingPopularReviews] = useState(true);

  const [revealedSpoilers, setRevealedSpoilers] = useState([]);

  const [myUserId, setMyUserId] = useState(null);

  // Prevent duplicate initial progress requests from racing each other.
  const progressLoadingRef = useRef(false);
  const hasLoadedProgressRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(null);
  // SCENE_114_TV_RATING_UI_V1: connect an authoritative backend summary here.
  const [sceneRatingSummary, setSceneRatingSummary] = useState(null);

  const [
    tmdbArabicTagline,
    setTmdbArabicTagline,
  ] = useState("");
  const [posterOverride, setPosterOverride] = useState(null);

  const [myProgress, setMyProgress] = useState(null);


  const [friendsProgress, setFriendsProgress] = useState([]);

  const [friendsAveragePercent, setFriendsAveragePercent] = useState(0);

  const [showFriendsModal, setShowFriendsModal] = useState(false);

  const [loadingProgress, setLoadingProgress] = useState(true);

  const [showAllCast, setShowAllCast] = useState(false);

  const [arabicCastNames, setArabicCastNames] =
    useState({});

  const [showEpisodePicker, setShowEpisodePicker] = useState(false);

  const [
    celebrateEpisodePickerOnOpen,
    setCelebrateEpisodePickerOnOpen,
  ] = useState(false);

  useEffect(() => {
    if (route.params?.celebrateShowCompletion !== true) {
      return;
    }

    /*
     * A normal episode log just completed the show.
     * Open the existing picker celebration automatically.
     */
    setCelebrateEpisodePickerOnOpen(true);
    setInitialPickerSeason(null);
    setShowEpisodePicker(true);

    /*
     * Consume the route flag so manually opening the picker
     * later does not celebrate again.
     */
    navigation.setParams({
      celebrateShowCompletion: false,
    });
  }, [
    route.params?.celebrateShowCompletion,
    navigation,
  ]);

  const [initialPickerSeason, setInitialPickerSeason] = useState(null);

  const displayTitle = useMemo(() => {
    if (!show) return t("Untitled");

    const originalLanguage =
      String(
        show.originalLanguage ||
        show.original_language ||
        ""
      ).toLowerCase();

    if (originalLanguage === "ar") {
      return (
        show.nameAr ||
        show.originalName ||
        show.nameEn ||
        show.name ||
        t("Untitled")
      );
    }

    return (
      show.nameEn ||
      show.name ||
      show.originalName ||
      t("Untitled")
    );
  }, [show, t]);

  const isSaudiProductionShow = useMemo(
    () => isSaudiShow(show),
    [show]
  );

  useEffect(() => {
    if (!isSaudiProductionShow) {
      saudiGlow.stopAnimation();
      saudiGlow.setValue(0);
      return;
    }

    saudiGlow.setValue(0);

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(saudiGlow, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(saudiGlow, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [isSaudiProductionShow, saudiGlow]);
  // SCENE_ARABIC_SHOW_TAGLINE_LOOKUP
  useEffect(() => {
    let active = true;

    const loadArabicShowTagline = async () => {
      if (
        language !== "ar" ||
        !showTmdbId
      ) {
        if (active) {
          setTmdbArabicTagline("");
        }
        return;
      }

      const apiKey =
        process.env.EXPO_PUBLIC_TMDB_API_KEY;

      if (!apiKey) return;

      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/tv/${showTmdbId}` +
            `?api_key=${apiKey}` +
            `&language=ar-SA` +
            `&append_to_response=translations`
        );

        if (!res.ok) return;

        const data = await res.json();

        const translations =
          data?.translations?.translations || [];

        const arabic =
          translations.find(
            (tr) =>
              tr?.iso_639_1 === "ar" &&
              tr?.iso_3166_1 === "SA"
          ) ||
          translations.find(
            (tr) =>
              tr?.iso_639_1 === "ar"
          );

        const translatedTagline =
          String(
            arabic?.data?.tagline || ""
          ).trim();

        const localizedTagline =
          String(
            data?.tagline || ""
          ).trim();

        if (active) {
          setTmdbArabicTagline(
            translatedTagline ||
            localizedTagline ||
            ""
          );
        }
      } catch (error) {
        console.warn(
          "⚠️ Arabic show tagline lookup failed:",
          error?.message || error
        );
      }
    };

    loadArabicShowTagline();

    return () => {
      active = false;
    };
  }, [
    language,
    showTmdbId,
  ]);



  const displayTagline = useMemo(() => {
    if (!show) return "";

    if (language === "ar") {
      return (
        show?.taglineAr ||
        show?.tagline_ar ||
        show?.taglineAR ||
        tmdbArabicTagline ||
        show?.taglineEn ||
        show?.tagline ||
        ""
      );
    }

    return (
      show?.taglineEn ||
      show?.tagline ||
      show?.taglineAr ||
      show?.tagline_ar ||
      ""
    );
  }, [
    show,
    language,
    tmdbArabicTagline,
  ]);

  const displayGenres = useMemo(() => {
    return normalizeArray(show?.genres)
      .map((genre) => {
        if (typeof genre === "string") {
          return language === "ar"
            ? t(genre)
            : genre;
        }

        const englishName =
          genre?.nameEn ||
          genre?.name_en ||
          genre?.name ||
          genre?.originalName ||
          "";

        if (
      String(language || "").toLowerCase() === "ar" ||
      String(language || "").toLowerCase() === "arabic" ||
      String(language || "").toLowerCase().startsWith("ar-") ||
      String(language || "").toLowerCase().startsWith("ar_")
    ) {
          return (
            genre?.nameAr ||
            genre?.name_ar ||
            (englishName ? t(englishName) : "")
          );
        }

        return englishName;
      })
      .filter(Boolean);
  }, [show, language, t]);

  const displayOverview = useMemo(() => {
    if (!show) return "";

    if (
      language === "ar" &&
      show.overviewAr &&
      String(show.overviewAr).trim()
    ) {
      return show.overviewAr;
    }

    return show.overviewEn || "";
  }, [show, language]);

  const seasons = useMemo(() => {
    return normalizeArray(show?.seasons)
      .filter((season) => {
        const seasonNumber = getSeasonNumber(season);

        return seasonNumber !== null && seasonNumber > 0;
      })
      .sort((a, b) => getSeasonNumber(a) - getSeasonNumber(b));
  }, [show]);

  const topCast = useMemo(() => {
    return normalizeArray(show?.cast).slice(0, 12);
  }, [show]);

  const allCast = useMemo(() => {
    return normalizeArray(show?.cast);
  }, [show]);

  const visibleCast = useMemo(() => {
    return showAllCast ? allCast.slice(0, 27) : allCast.slice(0, 6);
  }, [allCast, showAllCast]);

  useEffect(() => {
    let active = true;

    const loadArabicCastNames = async () => {
      if (
        !isArabicUI ||
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
            const personId = Number(
              actor?.id ??
                actor?.actorId
            );

            if (!Number.isFinite(personId)) {
              return null;
            }

            const existingArabicName =
              actor?.nameAr ||
              actor?.actorNameAr ||
              actor?.arabicName ||
              actor?.nameArabic ||
              "";

            if (
              existingArabicName &&
              containsArabic(existingArabicName)
            ) {
              return [
                personId,
                existingArabicName,
              ];
            }

            const cacheKey =
              `personArabicName:v1:${personId}`;

            try {
              const cached =
                await AsyncStorage.getItem(
                  cacheKey
                );

              if (
                cached &&
                containsArabic(cached)
              ) {
                return [
                  personId,
                  cached,
                ];
              }
            } catch {}

            try {
              const response = await fetch(
                `https://api.themoviedb.org/3/person/${personId}?api_key=${EXPO_TMDB_KEY}&language=ar-SA`
              );

              if (!response.ok) {
                return null;
              }

              const data =
                await response.json();

              const arabicName =
                data?.name &&
                containsArabic(data.name)
                  ? data.name.trim()
                  : "";

              if (!arabicName) {
                return null;
              }

              try {
                await AsyncStorage.setItem(
                  cacheKey,
                  arabicName
                );
              } catch {}

              return [
                personId,
                arabicName,
              ];
            } catch {
              return null;
            }
          })
        );

        if (!active) return;

        const names = {};

        entries.forEach((entry) => {
          if (!entry) return;

          const [personId, name] =
            entry;

          names[personId] = name;
        });

        setArabicCastNames(names);
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
    isArabicUI,
    EXPO_TMDB_KEY,
    visibleCast,
  ]);

  const creators = useMemo(() => {
    return normalizeArray(show?.creators);
  }, [show]);

  const directors = useMemo(() => {
    return normalizeArray(show?.directors);
  }, [show]);

  const myPercent = useMemo(() => {
    return getProgressPercent(myProgress);
  }, [myProgress]);

  const myWatchedCount = useMemo(() => {
    return getWatchedCount(myProgress);
  }, [myProgress]);

  const totalEpisodes = useMemo(() => {
    return getTotalCount(myProgress, show);
  }, [myProgress, show]);

  const airedEpisodeCount = useMemo(() => {
    return Number(myProgress?.airedEpisodeCount || 0);
  }, [myProgress]);

  const canReviewShow =
    airedEpisodeCount > 0 && myWatchedCount >= airedEpisodeCount;

  const loadShow = useCallback(async () => {
    if (!Number.isInteger(showTmdbId) || showTmdbId < 1) {
      setShow(null);
      setPosterOverride(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Prevent the previous show's poster from briefly carrying over
      // when navigating directly between show pages.
      setPosterOverride(null);

      const [showResult, posterResult, tmdbResult] =
        await Promise.allSettled([
          api.get(`/api/shows/${showTmdbId}`),

          api.get(
            `/api/custom-show-posters/show/${showTmdbId}/me`
          ),

          EXPO_TMDB_KEY
            ? fetch(
                `https://api.themoviedb.org/3/tv/${showTmdbId}?api_key=${EXPO_TMDB_KEY}&language=en-US`
              ).then((response) =>
                response.ok ? response.json() : null
              )
            : Promise.resolve(null),
        ]);

      if (showResult.status !== "fulfilled") {
        throw showResult.reason;
      }

      const loadedShow = showResult.value?.data || null;

      const tmdbShow =
        tmdbResult?.status === "fulfilled"
          ? tmdbResult.value
          : null;

      const hydratedShow = loadedShow
        ? {
            ...loadedShow,

            productionCountries:
              loadedShow.productionCountries ||
              loadedShow.production_countries ||
              tmdbShow?.production_countries ||
              [],

            productionCompanies:
              loadedShow.productionCompanies ||
              loadedShow.production_companies ||
              tmdbShow?.production_companies ||
              [],

            originCountry:
              loadedShow.originCountry ||
              loadedShow.origin_country ||
              tmdbShow?.origin_country ||
              [],
          }
        : null;

      const customPoster =
        posterResult.status === "fulfilled"
          ? posterResult.value?.data?.poster?.posterUrl || null
          : null;

      // Set both before loading becomes false, so the first visible
      // render already uses the correct custom poster.
      setShow(hydratedShow);
      setPosterOverride(customPoster);
    } catch (error) {
      console.error(
        "❌ Failed to load show:",
        error?.response?.data || error?.message || error,
      );

      setShow(null);
      setPosterOverride(null);
    } finally {
      setLoading(false);
    }
  }, [showTmdbId, EXPO_TMDB_KEY]);

  const loadShowRatings = useCallback(async () => {
    if (!Number.isInteger(showTmdbId) || showTmdbId < 1) {
      setLoadingShowRatings(false);
      return;
    }

    try {
      setLoadingShowRatings(true);

      const storedRaw = await AsyncStorage.getItem("user");

      const storedUser = storedRaw ? JSON.parse(storedRaw) : null;

      let currentAvatar = storedUser?.avatar || FALLBACK_AVATAR;

      if (storedUser?._id) {
        try {
          const profileRes = await api.get(`/api/users/${storedUser._id}`);

          currentAvatar = profileRes.data?.avatar || currentAvatar;
        } catch {}
      }

      setMyAvatar(currentAvatar);

      const [myReviewResult, friendsResult] = await Promise.allSettled([
        api.get(`/api/show-reviews/my/${showTmdbId}`),

        api.get(`/api/show-reviews/show/${showTmdbId}/friends`, {
          params: {
            page: 1,
            limit: 50,
            sort: "newest",
          },
        }),
      ]);

      const mine =
        myReviewResult.status === "fulfilled"
          ? myReviewResult.value?.data?.review || null
          : null;

      const friends =
        friendsResult.status === "fulfilled" &&
        Array.isArray(friendsResult.value?.data?.results)
          ? friendsResult.value.data.results
          : [];

      setMyShowReview(mine);

      setFriendShowReviews(
        friends.filter((review) => typeof review?.rating === "number"),
      );
    } catch (error) {
      console.error(
        "❌ Failed to load show ratings:",
        error?.response?.data || error?.message || error,
      );

      setMyShowReview(null);
      setFriendShowReviews([]);
    } finally {
      setLoadingShowRatings(false);
    }
  }, [showTmdbId]);

  const loadPopularShowReviews = useCallback(async () => {
    if (!Number.isInteger(showTmdbId) || showTmdbId < 1) {
      setLoadingPopularReviews(false);
      return;
    }

    try {
      setLoadingPopularReviews(true);

      const storedRaw = await AsyncStorage.getItem("user");

      const storedUser = storedRaw ? JSON.parse(storedRaw) : null;

      setMyUserId(storedUser?._id || null);

      const res = await api.get(`/api/show-reviews/show/${showTmdbId}`, {
        params: {
          page: 1,
          limit: 50,
          sort: "most-liked",
        },
      });

      const reviews = Array.isArray(res.data?.results)
        ? res.data.results
        : [];

      const actualReviews = reviews
        .filter(hasShowReviewContent)
        .slice(0, 3);

      setPopularShowReviews(actualReviews);
    } catch (error) {
      console.error(
        "❌ Failed to load popular show reviews:",
        error?.response?.data || error?.message || error,
      );

      setPopularShowReviews([]);
    } finally {
      setLoadingPopularReviews(false);
    }
  }, [showTmdbId]);

  const loadProgress = useCallback(async () => {
    if (!Number.isInteger(showTmdbId) || showTmdbId < 1) {
      setLoadingProgress(false);
      return;
    }

    // The initial effect and navigation focus could previously fire together.
    // That caused two requests to fight and made the percentage flash 0%.
    if (progressLoadingRef.current) return;

    progressLoadingRef.current = true;

    try {
      // Only display the spinner during the first load.
      // Later focus refreshes preserve the existing percentage.
      if (!hasLoadedProgressRef.current) {
        setLoadingProgress(true);
      }

      const stored = await AsyncStorage.getItem("user");

      const me = stored ? JSON.parse(stored) : null;

      if (!me?._id) {
        setMyProgress(null);
        setFriendsProgress([]);
        setFriendsAveragePercent(0);
        return;
      }

      const myProgressRes = await api.get(
        `/api/tv-progress/show/${showTmdbId}`,
      );

      setMyProgress(myProgressRes.data?.progress || null);

      const profileRes = await api.get(`/api/users/${me._id}`);

      const profile = profileRes.data || {};

      const following = normalizeArray(profile.following);

      const followingIds = following.map(getUserId).filter(Boolean);

      if (!followingIds.length) {
        setFriendsProgress([]);
        setFriendsAveragePercent(0);
        return;
      }

      const friendsRes = await api.post(
        `/api/tv-progress/show/${showTmdbId}/users`,
        {
          userIds: followingIds,
        },
      );

      const rawUsers = normalizeArray(friendsRes.data?.users);

      const followingMap = new Map(
        following.map((friend) => [getUserId(friend), friend]),
      );

      /*
       * `following` can contain only user IDs instead of populated
       * profile objects. Fetch any missing profiles so Friends Progress
       * always has the real username + avatar.
       */
      const missingProfileIds = followingIds.filter((friendId) => {
        const friend = followingMap.get(friendId);

        return !friend?.username || !friend?.avatar;
      });

      if (missingProfileIds.length > 0) {
        const profileResults = await Promise.allSettled(
          missingProfileIds.map((friendId) =>
            api.get(`/api/users/${friendId}`),
          ),
        );

        profileResults.forEach((result, index) => {
          if (result.status !== "fulfilled") return;

          const friendId = missingProfileIds[index];
          const fetchedProfile =
            result.value?.data?.user ||
            result.value?.data ||
            {};

          const existing = followingMap.get(friendId);

          followingMap.set(friendId, {
            ...(typeof existing === "object" && existing ? existing : {}),
            ...fetchedProfile,
          });
        });
      }

      const mergedFriends = followingIds.map((friendId) => {
        const progressEntry =
          rawUsers.find(
            (entry) =>
              getUserId(entry?.userId ?? entry?.user) === friendId,
          ) || null;

        const profileEntry = followingMap.get(friendId) || {};

        const progressUser =
          progressEntry?.user &&
          typeof progressEntry.user === "object"
            ? progressEntry.user
            : {};

        return {
          _id: friendId,

          username:
            profileEntry?.username ||
            profileEntry?.name ||
            progressUser?.username ||
            progressUser?.name ||
            progressEntry?.username ||
            "User",

          avatar:
            profileEntry?.avatar ||
            progressUser?.avatar ||
            progressEntry?.avatar ||
            null,

          progress: progressEntry?.progress || progressEntry || null,

          percent: getProgressPercent(
            progressEntry?.progress || progressEntry,
          ),

          watchedEpisodeCount: getWatchedCount(
            progressEntry?.progress || progressEntry,
          ),
        };
      });

      const startedFriends = mergedFriends.filter(
        (friend) => friend.watchedEpisodeCount > 0,
      );

      startedFriends.sort((a, b) => b.percent - a.percent);

      setFriendsProgress(startedFriends);

      const backendAverage = Number(friendsRes.data?.averageProgressPercentage);

      const calculatedAverage =
        startedFriends.length > 0
          ? Math.round(
              startedFriends.reduce((sum, friend) => sum + friend.percent, 0) /
                startedFriends.length,
            )
          : 0;

      setFriendsAveragePercent(
        Number.isFinite(backendAverage) && startedFriends.length > 0
          ? Math.round(backendAverage)
          : calculatedAverage,
      );
    } catch (error) {
      console.error(
        "❌ Failed to load show progress:",
        error?.response?.data || error?.message || error,
      );

      if (!hasLoadedProgressRef.current) {
        setMyProgress(null);
        setFriendsProgress([]);
        setFriendsAveragePercent(0);
      }
    } finally {
      progressLoadingRef.current = false;
      hasLoadedProgressRef.current = true;
      setLoadingProgress(false);
    }
  }, [showTmdbId]);

  useEffect(() => {
    loadShow();
  }, [loadShow]);

  useFocusEffect(
    useCallback(() => {
      loadProgress();
      loadShowRatings();
      loadPopularShowReviews();
    }, [loadProgress, loadShowRatings, loadPopularShowReviews]),
  );

  useEffect(() => {
    hasLoadedProgressRef.current = false;
    progressLoadingRef.current = false;
    setLoadingProgress(true);
    setMyProgress(null);
    setFriendsProgress([]);
    setFriendsAveragePercent(0);

    setLoadingShowRatings(true);
    setMyShowReview(null);
    setFriendShowReviews([]);
    setShowRatingsModal(false);
    setShowAllCast(false);
    setLoadingPopularReviews(true);
    setPopularShowReviews([]);
    setRevealedSpoilers([]);

    scrollRef.current?.scrollTo?.({
      y: 0,
      animated: false,
    });
  }, [showTmdbId]);

  const openTrailer = async () => {
    const trailerUrl = show?.trailer?.url;

    if (!trailerUrl) {
      Alert.alert(t("Trailer"), t("No trailer found."));
      return;
    }

    try {
      const supported = await Linking.canOpenURL(trailerUrl);

      if (!supported) {
        Alert.alert(t("Trailer"), t("Unable to open trailer."));
        return;
      }

      await Linking.openURL(trailerUrl);
    } catch {
      Alert.alert(t("Trailer"), t("Unable to open trailer."));
    }
  };

  const scrollToSeasons = () => {
    scrollRef.current?.scrollTo?.({
      y: Math.max(0, seasonsYRef.current - 20),
      animated: true,
    });
  };

  const openSeason = (season) => {
    const seasonNumber = getSeasonNumber(season);

    if (seasonNumber === null) return;

    setInitialPickerSeason(seasonNumber);

    setShowEpisodePicker(true);
  };

  const openEpisodeLogger = () => {
    if (!seasons.length) {
      Alert.alert(t("Log Episode"), t("No seasons found."));

      return;
    }

    // Log Episode button opens every season collapsed.
    setInitialPickerSeason(null);
    setShowEpisodePicker(true);
  };

  const openShowReviewComposer = () => {
    navigation.navigate("ShowLog", {
      showTmdbId,
      show,

      progressPercent:
        Number(
          show?.viewer?.progressPercent ??
            show?.viewer?.progressPercentage ??
            show?.progressPercent ??
            show?.progressPercentage ??
            0,
        ) || 0,
    });
  };

  const makeAutoAsk = () => {
    if (
      String(language || "").toLowerCase() === "ar" ||
      String(language || "").toLowerCase() === "arabic" ||
      String(language || "").toLowerCase().startsWith("ar-") ||
      String(language || "").toLowerCase().startsWith("ar_")
    ) {
      return `بدون حرق أحداث: ما رأيك في مسلسل «${displayTitle}»؟ وما الذي يميّزه؟`;
    }

    return `No spoilers: what do you think about “${displayTitle}”? What makes this show stand out?`;
  };

  const handleLikeShowReview = async (reviewId) => {
    if (!reviewId || !myUserId) return;

    const previousReviews = popularShowReviews;

    setPopularShowReviews((current) =>
      current.map((review) => {
        if (getReviewId(review) !== reviewId) {
          return review;
        }

        const currentlyLiked = Boolean(review?.engagement?.likedByViewer);

        return {
          ...review,

          engagement: {
            ...(review.engagement || {}),

            likedByViewer: !currentlyLiked,

            likeCount: Math.max(
              0,
              getShowReviewLikeCount(review) + (currentlyLiked ? -1 : 1),
            ),
          },
        };
      }),
    );

    try {
      await api.post(`/api/show-reviews/${reviewId}/like`);
    } catch (error) {
      setPopularShowReviews(previousReviews);

      console.error(
        "❌ Show review like failed:",
        error?.response?.data || error?.message || error,
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={SCENE_ACCENT} />

        <Text style={styles.loadingText}>{t("Loading show...")}</Text>
      </View>
    );
  }

  if (!show) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>{t("Show not found.")}</Text>

        <TouchableOpacity
          style={styles.errorBackButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.errorBackText}>{t("Go Back")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const poster =
    posterOverride ||
    show.poster ||
    (show.posterPath ? `${TMDB_POSTER}${show.posterPath}` : FALLBACK_POSTER);

  const backdrop =
    show.backdrop ||
    (show.backdropPath
      ? `https://image.tmdb.org/t/p/original${show.backdropPath}`
      : null);

  return (
    <View style={styles.container}>
      {isSaudiProductionShow && (
        <View
          pointerEvents="none"
          style={styles.saudiEdgeLayer}
        >
          <Animated.View
            style={[
              styles.saudiEdgeGlow,
              styles.saudiEdgeGlowLeft,
              {
                opacity: saudiGlow.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.20, 0.62],
                }),
                transform: [
                  {
                    scaleY: saudiGlow.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.96, 1],
                    }),
                  },
                ],
              },
            ]}
          />

          <Animated.View
            style={[
              styles.saudiEdgeGlow,
              styles.saudiEdgeGlowRight,
              {
                opacity: saudiGlow.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.18, 0.55],
                }),
                transform: [
                  {
                    scaleY: saudiGlow.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.96, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
      )}

      <ShowTopBar
        show={show}
        onPosterChanged={setPosterOverride}
      />

      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        bounces
        alwaysBounceVertical
        onScroll={Animated.event(
          [
            {
              nativeEvent: {
                contentOffset: {
                  y: showScrollY,
                },
              },
            },
          ],
          {
            useNativeDriver: true,
          },
        )}
      >
        {!!backdrop && (
          <View style={styles.backdropWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.showStretchBackdropLayer,
                {
                  transform: [
                    {
                      translateY:
                        stretchyShowBackdropTranslateY,
                    },
                    {
                      scale:
                        stretchyShowBackdropScale,
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

              <Animated.Image
                source={{ uri: backdrop }}
                style={[
                  styles.showBackdropBlurLayer,
                  {
                    opacity:
                      stretchyShowBackdropBlurOpacity,
                  },
                ]}
                resizeMode="cover"
                blurRadius={14}
              />

              <Animated.View
                style={[
                  StyleSheet.absoluteFillObject,
                  styles.showBackdropPullShade,
                  {
                    opacity:
                      stretchyShowBackdropBlurOpacity,
                  },
                ]}
              />
            </Animated.View>

            <LinearGradient
              pointerEvents="none"
              colors={[
                "rgba(14,14,14,0)",
                "rgba(14,14,14,0.65)",
                "#0e0e0e",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.backdropGradient}
            />
          </View>
        )}

        <View
          style={[
            styles.hero,
            !backdrop && {
              marginTop: 100,
            },
          ]}
        >
          <Image source={{ uri: poster }} style={styles.poster} />

          <View style={styles.heroInfo}>
            <Text style={styles.title}>{displayTitle}</Text>

            {isSaudiProductionShow && (
              <Animated.View
                style={[
                  styles.saudiBadge,
                  {
                    opacity: saudiGlow.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.84, 1],
                    }),
                  },
                ]}
              >
                <Text style={styles.saudiBadgeFlag}>🇸🇦</Text>

                <Text style={styles.saudiBadgeText}>
                  {t("Saudi Series")}
                </Text>
              </Animated.View>
            )}

            {!!displayTagline && (
              <Text style={styles.tagline} numberOfLines={2}>
                {displayTagline}
              </Text>
            )}

            <Text style={styles.meta}>
              {show.year || "—"} • {show.numberOfSeasons || 0} {t("seasons")} •{" "}
              {show.numberOfEpisodes || 0} {t("episodes")}
            </Text>

            {!!displayGenres.length && (
              <Text style={styles.meta} numberOfLines={2}>
                {displayGenres.join(" • ")}
              </Text>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.flexButton]}
                onPress={openEpisodeLogger}
              >
                <Ionicons name="add" size={15} color="#fff" />

                <Text style={styles.actionText}>{t("Log Episode")}</Text>
              </TouchableOpacity>

              {canReviewShow ? (
                <TouchableOpacity
                  style={[styles.actionButton, styles.flexButton]}
                  onPress={openShowReviewComposer}
                >
                  <Ionicons name="star-outline" size={16} color="#fff" />

                  <Text style={styles.actionText}>{t("Review Show")}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionButton, styles.flexButton]}
                  onPress={openTrailer}
                >
                  <Ionicons name="play-outline" size={16} color="#fff" />

                  <Text style={styles.actionText}>{t("Trailer")}</Text>
                </TouchableOpacity>
              )}
            </View>

            {canReviewShow ? (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.flexButton]}
                  onPress={openTrailer}
                >
                  <Ionicons name="play-outline" size={16} color="#fff" />

                  <Text style={styles.actionText}>{t("Trailer")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.flexButton]}
                  onPress={() =>
                    navigation.navigate("SceneBotScreen", {
                      show: {
                        id: showTmdbId,
                        tmdbId: showTmdbId,
                        title: displayTitle,
                        name: displayTitle,
                        poster,
                      },

                      autoAsk: makeAutoAsk(),
                    })
                  }
                >
                  <Ionicons name="sparkles-outline" size={15} color="#fff" />

                  <Text style={styles.actionText}>{t("Ask SceneBot")}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.sceneBotButton]}
                onPress={() =>
                  navigation.navigate("SceneBotScreen", {
                    show: {
                      id: showTmdbId,
                      tmdbId: showTmdbId,
                      title: displayTitle,
                      name: displayTitle,
                      poster,
                    },

                    autoAsk: makeAutoAsk(),
                  })
                }
              >
                <Ionicons name="sparkles-outline" size={15} color="#fff" />

                <Text style={styles.actionText}>{t("Ask SceneBot")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {!!displayOverview && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>{t("Overview")}</Text>

              {show.voteAverage > 0 && (
                <View style={styles.ratingHeader}>
                  <StarRating rating={show.voteAverage} size={12} />

                  <Text style={styles.ratingText}>
                    {Number(show.voteAverage).toFixed(1)}
                    {show.voteCount ? ` (${show.voteCount})` : ""}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.overview}>{displayOverview}</Text>
          </View>
        )}

        <SceneCommunityRatingPolygon summary={sceneRatingSummary} />

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Soundtrack</Text>
          <SoundtrackTab
            title={show?.nameEn || show?.name || displayTitle}
            year={Number(String(show?.firstAirDate || show?.first_air_date || "").slice(0,4)) || null}
            type="show"
            hideWhenMissing
          />
        </View>

        <View
          style={styles.section}
          onLayout={(event) => {
            seasonsYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>{t("Seasons")}</Text>

            <Text style={styles.sectionCount}>{seasons.length}</Text>
          </View>

          {!seasons.length ? (
            <Text style={styles.subtle}>{t("No seasons found.")}</Text>
          ) : (
            <FlatList
              data={seasons}
              horizontal
              scrollEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) =>
                `${getSeasonNumber(item)}-${item.id || index}`
              }
              contentContainerStyle={styles.seasonList}
              renderItem={({ item }) => {
                const seasonNumber = getSeasonNumber(item);

                return (
                  <TouchableOpacity
                    style={styles.seasonCard}
                    onPress={() => openSeason(item)}
                    activeOpacity={0.86}
                  >
                    <Image
                      source={{
                        uri: getSeasonPoster(item),
                      }}
                      style={styles.seasonPoster}
                    />

                    <Text style={styles.seasonName} numberOfLines={1}>
                      {isArabicUI
                        ? `${t("Season")} ${seasonNumber}`
                        : item.name || `${t("Season")} ${seasonNumber}`}
                    </Text>

                    <Text style={styles.seasonMeta}>
                      {item.episodeCount || 0} {t("episodes")}
                    </Text>

                    <View style={styles.seasonFooter}>
                      <Text style={styles.seasonYear}>
                        {item.airDate ? String(item.airDate).slice(0, 4) : "—"}
                      </Text>

                      <Ionicons name="chevron-forward" size={15} color="#777" />
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>

        <View style={styles.progressSection}>
          <Text style={styles.sectionHeader}>{t("Show Progress")}</Text>

          <View style={styles.progressRow}>
            <View style={styles.progressCard}>
              <Text style={styles.progressLabel}>{t("You Watched")}</Text>

              {loadingProgress ? (
                <ActivityIndicator size="small" color={SCENE_ACCENT} />
              ) : (
                <Text style={styles.progressValue}>{myPercent}%</Text>
              )}

              <Text style={styles.progressHint}>
                {myWatchedCount} / {totalEpisodes || show.numberOfEpisodes || 0}{" "}
                {t("episodes")}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.progressCard}
              onPress={() => setShowFriendsModal(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.progressLabel}>{t("Friends")}</Text>

              {loadingProgress ? (
                <ActivityIndicator size="small" color={SCENE_ACCENT} />
              ) : (
                <Text style={styles.progressValue}>
                  {friendsAveragePercent}%
                </Text>
              )}

              <View style={styles.progressHintRow}>
                <Ionicons
                  name="people-outline"
                  size={12}
                  color="#999"
                  top="3"
                />

                <Text style={styles.progressHint}>
                  {friendsProgress.length} {t("friends started")}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ alignItems: "center", marginTop: 16 }}>
             
          </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>{t("Friends Ratings")}</Text>

            {friendShowReviews.length > 4 && (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("ShowFriendsRatings", {
                    showTmdbId,
                    title: displayTitle,
                  })
                }
                activeOpacity={0.8}
              >
                <Text style={styles.ratingsMoreText}>{t("More")} →</Text>
              </TouchableOpacity>
            )}
          </View>


          {loadingShowRatings ? (
            <View style={styles.ratingsLoading}>
              <ActivityIndicator size="small" color={SCENE_ACCENT} />
            </View>
          ) : (
            <View style={styles.ratingsRow}>
              {/* Your rating — always separate and first */}
              <View style={styles.myRatingColumn}>
                <Text style={styles.myRatingLabel}>{t("You")}</Text>

                <TouchableOpacity
                  style={styles.ratingPerson}
                  disabled={!myShowReview}
                  activeOpacity={0.85}
                  onPress={() => {
                    const reviewId = getReviewId(myShowReview);

                    if (reviewId) {
                      navigation.navigate("ShowReview", {
                        reviewId,
                        showTmdbId,
                      });
                    }
                  }}
                >
                  <Image
                    source={{
                      uri:
                        myShowReview?.user?.avatar ||
                        myAvatar ||
                        FALLBACK_AVATAR,
                    }}
                    style={[styles.ratingAvatar, styles.myRatingAvatar]}
                  />

                  {typeof myShowReview?.rating === "number" ? (
                    <>
                      <StarRating rating={myShowReview.rating} size={10} />

                      {!!myShowReview.teamTag && (
                        <Text style={styles.ratingTeamTag} numberOfLines={1}>
                          {myShowReview.teamTag}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.noRatingText}>{t("Not rated")}</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.ratingDivider} />

              {/* Four friends */}
              <View style={styles.friendRatingsRow}>
                {friendShowReviews.length === 0 ? (
                  <Text style={styles.noFriendRatings}>
                    {t("No friends have rated this show yet.")}
                  </Text>
                ) : (
                  friendShowReviews.slice(0, 4).map((review) => {
                    const reviewId = getReviewId(review);

                    const userId = getReviewUserId(review);

                    return (
                      <TouchableOpacity
                        key={reviewId || userId}
                        style={styles.ratingPerson}
                        activeOpacity={0.85}
                        onPress={() => {
                          if (reviewId) {
                            navigation.navigate("ShowReview", {
                              reviewId,
                              showTmdbId,
                            });
                          }
                        }}
                      >
                        <Image
                          source={{
                            uri: review?.user?.avatar || FALLBACK_AVATAR,
                          }}
                          style={styles.ratingAvatar}
                        />

                        <StarRating
                          rating={Number(review.rating) || 0}
                          size={10}
                        />

                        {!!review.teamTag && (
                          <Text style={styles.ratingTeamTag} numberOfLines={1}>
                            {review.teamTag}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}
        </View>

        <Modal
          visible={showRatingsModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowRatingsModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{t("Friends Ratings")}</Text>

                  <Text style={styles.modalSubtitle}>{displayTitle}</Text>
                </View>

                <TouchableOpacity onPress={() => setShowRatingsModal(false)}>
                  <Ionicons name="close" size={23} color="#aaa" />
                </TouchableOpacity>
              </View>

              {!friendShowReviews.length ? (
                <Text style={styles.modalEmpty}>
                  {t("No friends have rated this show yet.")}
                </Text>
              ) : (
                <FlatList
                  data={friendShowReviews}
                  keyExtractor={(item, index) =>
                    String(getReviewId(item) || getReviewUserId(item) || index)
                  }
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.showRatingRow}
                      activeOpacity={0.85}
                      onPress={() => {
                        const reviewId = getReviewId(item);

                        if (!reviewId) return;

                        setShowRatingsModal(false);

                        navigation.navigate("ShowReview", {
                          reviewId,
                          showTmdbId,
                        });
                      }}
                    >
                      <Image
                        source={{
                          uri: item?.user?.avatar || FALLBACK_AVATAR,
                        }}
                        style={styles.friendAvatar}
                      />

                      <View style={styles.showRatingInfo}>
                        <Text style={styles.showRatingUsername}>
                          @{item?.user?.username || t("User")}
                        </Text>

                        <View style={styles.showRatingMeta}>
                          <StarRating
                            rating={Number(item.rating) || 0}
                            size={12}
                          />

                          {!!item.teamTag && (
                            <Text style={styles.showRatingTeam}>
                              {item.teamTag}
                            </Text>
                          )}
                        </View>
                      </View>

                      <Ionicons name="chevron-forward" size={17} color="#666" />
                    </TouchableOpacity>
                  )}
                />
              )}
            </View>
          </View>
        </Modal>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>{t("Popular Reviews")}</Text>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() =>
                navigation.navigate("ShowReviews", {
                  showTmdbId,
                  title: displayTitle,
                  initialFilter: "all",
                })
              }
            >
              <Text style={styles.ratingsMoreText}>{t("More")} →</Text>
            </TouchableOpacity>
          </View>

          {loadingPopularReviews ? (
            <View style={styles.popularReviewsLoading}>
              <ActivityIndicator size="small" color={SCENE_ACCENT} />
            </View>
          ) : popularShowReviews.length === 0 ? (
            <Text style={styles.subtle}>{t("No show reviews yet.")}</Text>
          ) : (
            popularShowReviews.map((review) => {
              const reviewId = getReviewId(review);

              const containsSpoilers = Boolean(review?.containsSpoilers);

              const spoilerRevealed = revealedSpoilers.includes(reviewId);

              const media = getShowReviewMedia(review);

              const liked = Boolean(review?.engagement?.likedByViewer);

              return (
                <View key={reviewId} style={styles.popularReviewCard}>
                  <View style={styles.popularReviewHeader}>
                    <TouchableOpacity
                      onPress={() =>
                        navigation.navigate("ProfileScreen", {
                          id: review?.user?.id || review?.user?._id,
                        })
                      }
                    >
                      <Image
                        source={{
                          uri: review?.user?.avatar || FALLBACK_AVATAR,
                        }}
                        style={styles.popularReviewAvatar}
                      />
                    </TouchableOpacity>

                    <View style={styles.popularReviewUser}>
                      <Text
                        style={styles.popularReviewUsername}
                        numberOfLines={1}
                      >
                        @{review?.user?.username || t("User")}
                      </Text>

                      <View style={styles.popularReviewMeta}>
                        {typeof review?.rating === "number" && (
                          <StarRating rating={review.rating} size={11} />
                        )}

                        {!!review?.teamTag && (
                          <Text
                            style={styles.popularReviewTeam}
                            numberOfLines={1}
                          >
                            {review.teamTag}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>

                  {containsSpoilers && !spoilerRevealed ? (
                    <TouchableOpacity
                      style={styles.spoilerBox}
                      activeOpacity={0.85}
                      onPress={() =>
                        setRevealedSpoilers((current) => [...current, reviewId])
                      }
                    >
                      <Ionicons name="eye-off-outline" size={19} color="#aaa" />

                      <Text style={styles.spoilerTitle}>
                        {t("This review contains spoilers.")}
                      </Text>

                      <Text style={styles.spoilerHint}>
                        {t("Tap to reveal")}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      {!!review?.review && (
                        <Text
                          style={styles.popularReviewText}
                          numberOfLines={5}
                        >
                          {review.review}
                        </Text>
                      )}

                      {!!media.gif && (
                        <SceneRatioMedia
                          uri={media.gif}
                        />
                      )}

                      {!!media.image && (
                        <SceneRatioMedia
                          uri={media.image}
                        />
                      )}
                    </>
                  )}

                  <View style={styles.popularReviewActions}>
                    <TouchableOpacity
                      style={styles.popularReviewAction}
                      onPress={() => handleLikeShowReview(reviewId)}
                    >
                      <Ionicons
                        name={liked ? "heart" : "heart-outline"}
                        size={17}
                        color={liked ? SCENE_ACCENT : "#999"}
                      />

                      <Text
                        style={[
                          styles.popularReviewActionText,
                          liked && {
                            color: SCENE_ACCENT,
                          },
                        ]}
                      >
                        {getShowReviewLikeCount(review)}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.popularReviewAction}
                      onPress={() =>
                        navigation.navigate("ShowReviews", {
                          showTmdbId,
                          title: displayTitle,
                          initialFilter: "all",
                          replyTo: reviewId,
                          parentUsername: review?.user?.username,
                        })
                      }
                    >
                      <Ionicons
                        name="chatbubble-outline"
                        size={16}
                        color="#999"
                      />

                      <Text style={styles.popularReviewActionText}>
                        {getShowReviewReplyCount(review)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {!!creators.length && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>
              {creators.length > 1 ? t("Creators") : t("Creator")}
            </Text>

            {creators.map((creator) => (
              <TouchableOpacity
                key={String(creator.id)}
                style={styles.personRow}
                onPress={() =>
                  navigation.navigate("Director", {
                    id: creator.id,
                  })
                }
                activeOpacity={0.85}
              >
                <Image
                  source={{
                    uri:
                      creator.profile ||
                      (creator.profilePath
                        ? `${TMDB_PROFILE}${creator.profilePath}`
                        : FALLBACK_AVATAR),
                  }}
                  style={styles.creatorAvatar}
                />

                <View style={styles.personInfo}>
                  <Text style={styles.personName}>
                    {creator.name || t("Unknown")}
                  </Text>

                  <Text style={styles.personRole}>{t("Creator")}</Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#777" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!creators.length && !!directors.length && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t("Directors")}</Text>

            {directors.slice(0, 3).map((director) => (
              <TouchableOpacity
                key={`${director.id}-${director.creditId}`}
                style={styles.personRow}
                onPress={() =>
                  navigation.navigate("Director", {
                    id: director.id,
                  })
                }
              >
                <Image
                  source={{
                    uri:
                      director.profile ||
                      (director.profilePath
                        ? `${TMDB_PROFILE}${director.profilePath}`
                        : FALLBACK_AVATAR),
                  }}
                  style={styles.creatorAvatar}
                />

                <View style={styles.personInfo}>
                  <Text style={styles.personName}>{director.name}</Text>

                  <Text style={styles.personRole}>
                    {director.job || t("Director")}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!!visibleCast.length && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>{t("Starring")}</Text>

              {allCast.length > 6 && (
                <TouchableOpacity
                  onPress={() => setShowAllCast((current) => !current)}
                  activeOpacity={0.8}
                  style={styles.castMoreButton}
                >
                  <Text style={styles.castMoreText}>
                    {showAllCast ? t("Show Less") : `${t("More")}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.castGrid}>
              {visibleCast.map((actor) => {
                const itemWidth = (SCREEN_WIDTH - 32 - 20) / 3;

                return (
                  <TouchableOpacity
                    key={`${actor.id}-${actor.creditId}`}
                    style={[
                      styles.castCard,
                      {
                        width: itemWidth,
                      },
                    ]}
                    onPress={() =>
                      navigation.navigate("Actor", {
                        id: actor.id,
                      })
                    }
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{
                        uri:
                          actor.profile ||
                          (actor.profilePath
                            ? `${TMDB_PROFILE}${actor.profilePath}`
                            : FALLBACK_AVATAR),
                      }}
                      style={[
                        styles.castImage,
                        {
                          width: itemWidth,
                          height: Math.round(itemWidth * 1.5),
                        },
                      ]}
                    />

                    {!!actor.character && (
                      <Text
                        style={styles.castCharacter}
                        numberOfLines={2}
                      >
                        {actor.character}
                      </Text>
                    )}

                    <View style={styles.castNamesWrap}>
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
                          arabicCastNames[personId] ||
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
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </Animated.ScrollView>

      <ShowEpisodePickerModal
        visible={showEpisodePicker}
        show={show}
        showTmdbId={showTmdbId}
        initialSeasonNumber={initialPickerSeason}
        onClose={() => {
          setShowEpisodePicker(false);
          setInitialPickerSeason(null);
          setCelebrateEpisodePickerOnOpen(false);
        }}
        onProgressChanged={loadProgress}
        onRequestShowReview={openShowReviewComposer}
        celebrateOnOpen={celebrateEpisodePickerOnOpen}
      />

      <Modal
        visible={showFriendsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFriendsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{t("Friends Progress")}</Text>

                <Text style={styles.modalSubtitle}>{displayTitle}</Text>
              </View>

              <TouchableOpacity onPress={() => setShowFriendsModal(false)}>
                <Ionicons name="close" size={23} color="#aaa" />
              </TouchableOpacity>
            </View>

            {!friendsProgress.length ? (
              <Text style={styles.modalEmpty}>
                {t("No people you follow have started this show yet.")}
              </Text>
            ) : (
              <FlatList
                data={friendsProgress}
                keyExtractor={(item) => item._id}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.friendRow}
                    onPress={() => {
                      setShowFriendsModal(false);

                      navigation.navigate("ProfileScreen", {
                        id: item._id,
                      });
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.friendLeft}>
                      <Image
                        source={{
                          uri: item.avatar || FALLBACK_AVATAR,
                        }}
                        style={styles.friendAvatar}
                      />

                      <View>
                        <Text style={styles.friendName}>@{item.username}</Text>

                        <Text style={styles.friendSub}>
                          {item.watchedEpisodeCount} {t("episodes watched")}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.friendPercent}>{item.percent}%</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0e0e0e",
  },

  saudiEdgeLayer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 8,
    overflow: "hidden",
  },

  saudiEdgeGlow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 11,
    borderRadius: 999,
    backgroundColor: "#0B8F45",
    shadowColor: "#18A558",
    shadowOpacity: 0.95,
    shadowRadius: 30,
    shadowOffset: {
      width: 0,
      height: 0,
    },
  },

  saudiEdgeGlowLeft: {
    left: -5,
  },

  saudiEdgeGlowRight: {
    right: -5,
  },

  saudiBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,108,53,0.18)",
    borderWidth: 1,
    borderColor: "rgba(25,165,88,0.48)",
  },

  saudiBadgeFlag: {
    fontSize: 11,
  },

  saudiBadgeText: {
    color: "#D7F5E3",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.15,
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
    textAlign: "center",
  },

  errorBackButton: {
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
  },

  errorBackText: {
    color: "#fff",
    fontWeight: "700",
  },

  scrollContent: {
    paddingBottom: 120,
  },

  topBar: {
    position: "absolute",
    top: 46,
    left: 14,
    right: 14,
    zIndex: 30,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  topBarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  showStretchBackdropLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "visible",
  },

  showBackdropBlurLayer: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  showBackdropPullShade: {
    backgroundColor: "#000",
  },

  backdropWrap: {
    width: "100%",
    height: 280,
    backgroundColor: "#111",
  },

  backdrop: {
    width: "100%",
    height: "100%",
  },

  backdropGradient: {
    ...StyleSheet.absoluteFillObject,
  },

  hero: {
    marginTop: -80,
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 16,
  },

  poster: {
    width: 140,
    height: 210,
    borderRadius: 12,
    backgroundColor: "#222",
  },

  heroInfo: {
    flex: 1,
    justifyContent: "flex-end",
  },

  title: {
    color: "#fff",
    fontSize: 21,
    lineHeight: 32,
    fontWeight: "800",
    fontFamily: "Tajawal_800ExtraBold",
    paddingTop: 3,
    paddingBottom: 3,
    overflow: "visible",
  },

  tagline: {
    color: "#aaa",
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 4,
  },

  meta: {
    color: "#ccc",
    fontSize: 11.5,
    marginTop: 4,
    lineHeight: 16,
  },

  status: {
    color: SCENE_ACCENT,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 5,
  },

  actionRow: {
    flexDirection: "row",
    gap: 7,
    marginTop: 10,
  },

  actionButton: {
    minHeight: 32,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#444",
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
  },

  flexButton: {
    flex: 1,
  },

  sceneBotButton: {
    marginTop: 7,
  },

  actionText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },

  castMoreButton: {
    paddingVertical: 8,
    paddingLeft: 10,
  },

  castMoreText: {
    color: "#aaa",
    fontSize: 13,
    fontWeight: "600",
  },

  section: {
    paddingHorizontal: 16,
    marginTop: 24,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },

  sectionCount: {
    color: "#888",
    fontSize: 12,
    marginBottom: 8,
  },

  moreText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },

  overview: {
    color: "#ddd",
    fontSize: 14.5,
    lineHeight: 21,
  },

  subtle: {
    color: "#888",
    fontSize: 13,
  },

  ratingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
  },

  ratingText: {
    color: "#aaa",
    fontSize: 11,
  },

  progressSection: {
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: "#111",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#222",
  },

  progressRow: {
    flexDirection: "row",
    gap: 10,
  },

  progressCard: {
    flex: 1,
    minHeight: 105,
    backgroundColor: "#181818",
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#292929",
  },

  progressLabel: {
    color: "#aaa",
    fontSize: 12,
    marginBottom: 5,
  },

  progressValue: {
    color: SCENE_ACCENT,
    fontSize: 18,
    fontWeight: "900",
  },

  progressHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },

  progressHint: {
    color: "#888",
    fontSize: 10.5,
    marginTop: 6,
    textAlign: "center",
  },

  adWrap: {
    alignItems: "center",
    marginTop: 18,
  },

  seasonList: {
    gap: 12,
    paddingRight: 16,
    paddingTop: 3,
  },

  seasonCard: {
    width: 118,
  },

  seasonPoster: {
    width: 118,
    height: 177,
    borderRadius: 10,
    backgroundColor: "#222",
  },

  seasonName: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 7,
  },

  seasonMeta: {
    color: "#888",
    fontSize: 10.5,
    marginTop: 2,
  },

  seasonFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 3,
  },

  seasonYear: {
    color: "#777",
    fontSize: 10,
  },

  personRow: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#222",
    marginTop: 4,
  },

  creatorAvatar: {
    width: 54,
    height: 72,
    borderRadius: 9,
    backgroundColor: "#222",
  },

  personInfo: {
    flex: 1,
    marginLeft: 12,
  },

  personName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },

  personRole: {
    color: "#888",
    fontSize: 11,
    marginTop: 3,
  },

  castGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 3,
  },

  castCard: {
    alignItems: "center",
  },

  castImage: {
    borderRadius: 10,
    backgroundColor: "#222",
  },

  castNamesWrap: {
    width: "100%",
    alignItems: "center",
    marginTop: 2,
  },

  castName: {
    color: "#aaa",
    fontSize: 10.5,
    fontWeight: "500",
    textAlign: "center",
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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.76)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },

  ratingsMoreText: {
    color: "#aaa",
    fontSize: 13,
    fontWeight: "600",
  },

  ratingsLoading: {
    height: 90,
    alignItems: "center",
    justifyContent: "center",
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

  showRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },

  showRatingInfo: {
    flex: 1,
    marginLeft: 12,
  },

  showRatingUsername: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 5,
  },

  showRatingMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  showRatingTeam: {
    color: SCENE_ACCENT,
    fontSize: 11,
    fontWeight: "700",
  },

  modalCard: {
    maxHeight: "78%",
    backgroundColor: "#111",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#252525",
  },

  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  modalTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },

  modalSubtitle: {
    color: "#888",
    fontSize: 12,
    marginTop: 3,
  },

  modalEmpty: {
    color: "#888",
    textAlign: "center",
    paddingVertical: 22,
  },

  friendRow: {
    minHeight: 58,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f1f",
    paddingVertical: 10,
  },

  friendLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  friendAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#222",
    marginRight: 10,
  },

  friendName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  friendSub: {
    color: "#777",
    fontSize: 10.5,
    marginTop: 2,
  },

  friendPercent: {
    color: SCENE_ACCENT,
    fontSize: 16,
    fontWeight: "900",
  },

  popularReviewsLoading: {
    height: 90,
    alignItems: "center",
    justifyContent: "center",
  },

  popularReviewCard: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },

  popularReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
  },

  popularReviewAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#222",
  },

  popularReviewUser: {
    flex: 1,
    marginLeft: 10,
  },

  popularReviewUsername: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "700",
  },

  popularReviewMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },

  popularReviewTeam: {
    color: SCENE_ACCENT,
    fontSize: 10,
    fontWeight: "700",
    flexShrink: 1,
  },

  popularReviewText: {
    color: "#ddd",
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 11,
  },

  popularReviewMedia: {
    width: "100%",
  },

  sceneRatioMediaWrap: {
    width: "100%",
    marginTop: 10,
    backgroundColor: "#000",
    borderRadius: 10,
    overflow: "hidden",
  },

  sceneRatioMedia: {
    width: "100%",
  },

  popularReviewActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 12,
  },

  popularReviewAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },

  popularReviewActionText: {
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
  },

  spoilerBox: {
    marginTop: 11,
    minHeight: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#171717",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },

  spoilerTitle: {
    color: "#ddd",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 7,
    textAlign: "center",
  },

  spoilerHint: {
    color: "#777",
    fontSize: 10.5,
    marginTop: 4,
  },

  showReviewOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },

  showReviewSheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "#282828",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
    maxHeight: "90%",
  },

  showReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },

  showReviewHeaderText: {
    flex: 1,
    paddingRight: 12,
  },

  showReviewTitle: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "900",
  },

  showReviewShowName: {
    color: "#888",
    fontSize: 12,
    marginTop: 3,
  },

  showReviewClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#202020",
    alignItems: "center",
    justifyContent: "center",
  },

  showReviewLabel: {
    color: "#ddd",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 9,
  },

  showReviewRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    marginBottom: 22,
  },

  showReviewRatingControl: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: "#242424",
    alignItems: "center",
    justifyContent: "center",
  },

  showReviewRatingValue: {
    minWidth: 112,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#1b1b1b",
    borderWidth: 1,
    borderColor: "#2d2d2d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  showReviewRatingText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },

  showReviewRatingMaximum: {
    color: "#777",
    fontSize: 12,
    fontWeight: "700",
  },

  showReviewInput: {
    minHeight: 132,
    maxHeight: 220,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#303030",
    backgroundColor: "#181818",
    color: "#fff",
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 18,
  },

  showReviewSpoilerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#181818",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#292929",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },

  showReviewSpoilerText: {
    flex: 1,
    paddingRight: 14,
  },

  showReviewSpoilerTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },

  showReviewSpoilerHint: {
    color: "#777",
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 3,
  },

  showReviewSubmit: {
    height: 50,
    borderRadius: 15,
    backgroundColor: SCENE_ACCENT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  showReviewSubmitDisabled: {
    opacity: 0.55,
  },

  showReviewSubmitText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
});
